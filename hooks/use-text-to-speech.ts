"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount } from "wagmi";
import config, { ttsModelId } from "@/config";
import useWeb3Clients from "@/hooks/use-web3-clients";
import { GatewayAuth } from "@/lib/protocol/gateway-auth";
import { GatewayClient } from "@/lib/protocol/gateway-client";
import { ProtocolTransport } from "@/lib/protocol/transport";

/**
 * idle          → nothing playing; the button offers "Read aloud".
 * synthesizing  → the TTS job is in flight (spinner); the button is inert.
 * playing       → audio is playing; the button offers "Stop".
 */
export type SpeechState = "idle" | "synthesizing" | "playing";

// One transport for the whole app, keyed by chain and wallet so a wallet
// switch replaces it. Every message's button shares the same speech session
// and relay socket instead of each holding its own from first click until
// that message unmounts.
const sharedTransports = new Map<string, ProtocolTransport>();

/**
 * Drives the assistant-message "read aloud" button.
 *
 * Gets the shared ProtocolTransport bound to the TTS model (tts-piper) and,
 * on demand, submits the message text as a one-off protocol job through the
 * exact same session/submit/decrypt machinery a normal prompt uses — see
 * ProtocolTransport.synthesizeSpeech. The job's base64-MP3 response is decoded
 * and played through an <audio> element. Nothing is written to the chat thread
 * or the database: read-aloud leaves no trace in the conversation.
 *
 * The transport is created lazily on first use and shared by every message
 * for the connected wallet; nothing is torn down per message.
 */
export function useTextToSpeech() {
  const { walletClient, publicClient } = useWeb3Clients();
  const { address } = useAccount();

  const [state, setState] = useState<SpeechState>("idle");

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // The protocol always targets the first configured chain, like the chat
  // session does.
  const protocolChainId = config.chains[0].id;

  // Read-aloud needs a connected wallet to pay for and sign the job. When it
  // isn't available the button is disabled with an explanatory tooltip.
  const isAvailable = Boolean(walletClient?.account && address);

  const releaseAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.onended = null;
      audioRef.current.onerror = null;
      audioRef.current.src = "";
      audioRef.current = null;
    }
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    releaseAudio();
    setState("idle");
  }, [releaseAudio]);

  // Teardown on unmount: abort any in-flight job and drop the audio. The
  // transport is shared across messages and outlives this component.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
      releaseAudio();
    };
  }, [releaseAudio]);

  const getTransport = useCallback(() => {
    const client = walletClient;
    if (!client?.account) {
      throw new Error("Wallet not connected — cannot read aloud");
    }
    const key = `${protocolChainId}:${client.account.address}`;
    const existing = sharedTransports.get(key);
    if (existing) {
      return existing;
    }

    const jobRegistryAddress = config.jobRegistryAddress[protocolChainId];
    const aiConfigAddress = config.aiConfigAddress[protocolChainId];
    const workerRegistryAddress = config.workerRegistryAddress[protocolChainId];
    if (
      !jobRegistryAddress ||
      jobRegistryAddress === "0x" ||
      !aiConfigAddress ||
      aiConfigAddress === "0x" ||
      !workerRegistryAddress ||
      workerRegistryAddress === "0x"
    ) {
      throw new Error(
        `Protocol contracts not configured for chain ${protocolChainId}`
      );
    }

    const transport = new ProtocolTransport({
      gateway: new GatewayClient(undefined, new GatewayAuth()),
      modelId: ttsModelId,
      sessionStorageKey: "lc-tts-session",
      walletClient: client,
      publicClient,
      jobRegistryAddress,
      aiConfigAddress,
      workerRegistryAddress,
      relayUrl: process.env.NEXT_PUBLIC_RELAY_URL || "ws://localhost:8888/ws",
      // Mirror the chat's submission mode: delegated when a prepaid balance is
      // set up, falling back to a per-prompt wallet TX otherwise.
      getSubmitMode: () => "auto",
      persistence: {
        // Read-aloud never touches chat history; synthesizeSpeech never calls
        // this, but the transport contract requires it.
        persistUserMessage: async () => {
          // intentionally a no-op
        },
      },
    });
    // A single shared transport for the app: a wallet switch releases the
    // previous wallet's session and socket instead of leaving it open.
    for (const [otherKey, other] of sharedTransports) {
      if (otherKey !== key) {
        other.release();
        sharedTransports.delete(otherKey);
      }
    }
    sharedTransports.set(key, transport);
    return transport;
  }, [walletClient, publicClient, protocolChainId]);

  /**
   * Toggles read-aloud for `text`:
   *   idle          → synthesize + play
   *   synthesizing  → cancel the in-flight job
   *   playing       → stop playback
   *
   * Rejects on failure so the caller can surface a toast; an aborted job
   * resolves quietly.
   */
  const speak = useCallback(
    async (text: string) => {
      if (state === "playing" || state === "synthesizing") {
        stop();
        return;
      }
      const clean = text.trim();
      if (!clean) {
        return;
      }

      const controller = new AbortController();
      abortRef.current = controller;
      setState("synthesizing");

      try {
        const transport = getTransport();
        const bytes = await transport.synthesizeSpeech(clean, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) {
          return;
        }

        // Copy into a plain ArrayBuffer-backed buffer: the decoded bytes are
        // typed over ArrayBufferLike, which BlobPart won't accept directly.
        const buffer = new ArrayBuffer(bytes.byteLength);
        new Uint8Array(buffer).set(bytes);
        const blob = new Blob([buffer], { type: "audio/mpeg" });
        const url = URL.createObjectURL(blob);
        urlRef.current = url;

        const audio = new Audio(url);
        audioRef.current = audio;
        audio.onended = () => {
          if (abortRef.current === controller) {
            abortRef.current = null;
          }
          releaseAudio();
          setState("idle");
        };
        audio.onerror = () => {
          if (abortRef.current === controller) {
            abortRef.current = null;
          }
          releaseAudio();
          setState("idle");
        };

        await audio.play();
        setState("playing");
      } catch (err) {
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
        releaseAudio();
        setState("idle");
        // A user-initiated cancel is not an error worth surfacing.
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }
        throw err;
      }
    },
    [state, stop, getTransport, releaseAudio]
  );

  return { state, isAvailable, speak, stop };
}
