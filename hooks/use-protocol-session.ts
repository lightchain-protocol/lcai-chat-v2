"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { WalletClient } from "viem";
import config from "@/config";
import useWeb3Clients from "@/hooks/use-web3-clients";
import { $http } from "@/lib/http";
import { GatewayAuth } from "@/lib/protocol/gateway-auth";
import { GatewayClient } from "@/lib/protocol/gateway-client";
import type { SessionStatus, SubmitMode } from "@/lib/protocol/session";
import type { FailoverStatus, TrackedJob } from "@/lib/protocol/transport";
import { ProtocolTransport } from "@/lib/protocol/transport";
import type { ProtocolLoadingStatus } from "@/lib/types";

/**
 * React hook that manages a LightChain protocol session.
 *
 * Lazily initializes on first use — session is created when getTransport()
 * is called (typically on first message send in chat.tsx).
 *
 * The local modelId (e.g. "chat-model") is resolved to the gateway's hex
 * model ID on first getTransport() call by fetching GET /api/models.
 */
// biome-ignore lint/nursery/useMaxParams: positional args mirror the prior signature; an options object would churn every call site.
export function useProtocolSession(
  modelId: string,
  walletClient: WalletClient | undefined,
  address: string | undefined,
  chatId: string,
  /**
   * Submission mode for prompts. Re-evaluated on every send, so the chat can
   * flip from "wallet" to "delegated" the moment the user finishes setting up
   * a prepaid balance. Defaults to "wallet" (legacy per-prompt TX).
   */
  submitMode: SubmitMode = "wallet"
) {
  const [status, setStatus] = useState<SessionStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [failoverStatus, setFailoverStatus] = useState<FailoverStatus>("none");
  // Heartbeat-advertised capability set of the bound worker (web-search epic,
  // Story 16). Refreshed whenever the session status changes — the transport
  // only knows it after SessionManager.initialize() completes.
  const [workerCapabilities, setWorkerCapabilities] = useState<string[]>([]);
  const [progressStatus, setProgressStatus] =
    useState<ProtocolLoadingStatus>("idle");
  const [activeJobs, setActiveJobs] = useState<TrackedJob[]>([]);
  const [timedOutJob, setTimedOutJob] = useState<TrackedJob | null>(null);
  const transportRef = useRef<ProtocolTransport | null>(null);
  const gatewayRef = useRef<GatewayClient | null>(null);
  const resolvedModelIdRef = useRef<string | null>(null);
  const walletClientRef = useRef(walletClient);
  const addressRef = useRef(address);
  const submitModeRef = useRef<SubmitMode>(submitMode);
  const walletAddress = address ?? null;
  const lastWalletAddressRef = useRef<string | null>(walletAddress);

  // Protocol always targets the first configured chain (lcaiDevnet),
  // regardless of which chain the wallet is connected to.
  const protocolChainId = config.chains[0].id;
  const { publicClient } = useWeb3Clients();

  useEffect(() => {
    walletClientRef.current = walletClient;
    addressRef.current = address;
  }, [address, walletClient]);

  useEffect(() => {
    submitModeRef.current = submitMode;
  }, [submitMode]);

  // Lazily create the gateway client — singleton per hook instance.
  // Auth piggybacks on the SIWE session token (lib/http.ts cache), so no
  // wallet signature is required to authenticate gateway calls.
  const getGateway = useCallback(() => {
    if (!gatewayRef.current) {
      gatewayRef.current = new GatewayClient(undefined, new GatewayAuth());
    }
    return gatewayRef.current;
  }, []);

  // Resolve local model ID to gateway hex ID (cached after first call)
  const resolveModelId = useCallback(async (): Promise<string> => {
    if (resolvedModelIdRef.current) return resolvedModelIdRef.current;

    const gateway = getGateway();
    const { models } = await gateway.getModels();

    if (models.length === 0) {
      throw new Error("No models available from gateway");
    }

    const match = models.find((m) =>
      m.name.toLowerCase().includes(modelId.toLowerCase())
    );
    const resolved = match?.id ?? models[0].id;
    resolvedModelIdRef.current = resolved;
    return resolved;
  }, [modelId, getGateway]);

  // Lazily create the transport — returns a promise since model resolution is async
  const getTransport = useCallback(async () => {
    if (transportRef.current) return transportRef.current;

    const client = walletClientRef.current;
    if (!client?.account) {
      throw new Error(
        "Wallet not connected — cannot create protocol transport"
      );
    }

    const gateway = getGateway();
    const hexModelId = await resolveModelId();

    const jobRegistryAddress = config.jobRegistryAddress[protocolChainId];
    const aiConfigAddress = config.aiConfigAddress[protocolChainId];

    if (!jobRegistryAddress || jobRegistryAddress === "0x") {
      throw new Error(
        `JobRegistry address not configured for chain ${protocolChainId}`
      );
    }
    if (!aiConfigAddress || aiConfigAddress === "0x") {
      throw new Error(
        `AIConfig address not configured for chain ${protocolChainId}`
      );
    }

    const workerRegistryAddress = config.workerRegistryAddress[protocolChainId];
    if (!workerRegistryAddress || workerRegistryAddress === "0x") {
      throw new Error(
        `WorkerRegistry address not configured for chain ${protocolChainId}`
      );
    }

    const transport = new ProtocolTransport({
      gateway,
      modelId: hexModelId,
      sessionStorageKey: `lc-protocol-session:${chatId}`,
      walletClient: client,
      publicClient,
      jobRegistryAddress,
      aiConfigAddress,
      workerRegistryAddress,
      relayUrl: process.env.NEXT_PUBLIC_RELAY_URL || "ws://localhost:8888/ws",
      getSubmitMode: () => submitModeRef.current,
      registerProtocolSession: async ({
        chatId: targetChatId,
        sessionId,
        modelId: modelIdHex,
      }) => {
        const response = await $http.put(
          `/api/chat/${targetChatId}/protocol-session`,
          {
            sessionId,
            modelId: modelIdHex,
          }
        );
        if (!response.ok) {
          throw new Error(
            `Failed to register protocol session: ${response.status} ${response.statusText}`
          );
        }
      },
      persistence: {
        persistUserMessage: async ({
          chatId: messageChatId,
          message,
          selectedVisibilityType,
          systemPrompt,
          sessionId,
          jobId,
        }) => {
          const response = await $http.post(
            `/api/chat/${messageChatId}/messages`,
            {
              id: message.id,
              sessionId,
              role: "user",
              parts: message.parts ?? [],
              attachments: [],
              selectedVisibilityType,
              systemPrompt,
              completionState: "completed",
              relaySource: "protocol-user",
              jobId,
              protocolMeta: { jobId, sessionId },
            }
          );

          if (!response.ok) {
            throw new Error(
              `Failed to persist user message: ${response.status} ${response.statusText}`
            );
          }
        },
      },
    });
    transport.setOnSessionStatus((s) => {
      setStatus(s as SessionStatus);

      if (s === "preparing" || s === "key_exchange") {
        setProgressStatus("preparing_chat");
      } else if (s === "creating") {
        setProgressStatus("writing_on_chain");
      } else if (s === "ready") {
        setProgressStatus("thinking");
      }

      if (s === "error") {
        setError("Session initialization failed");
        setProgressStatus("error");
      } else {
        setError(null);
      }
      // Refresh capability snapshot — the transport only knows the bound
      // worker's capabilities after the session reaches "ready". Reading on
      // every status change keeps the chat input's Switch in sync.
      setWorkerCapabilities(transport.workerCapabilities);
    });
    transport.setOnFailoverStatus(setFailoverStatus);
    transport.setOnProgressStatus(setProgressStatus);
    transport.setOnJobUpdate((job) => {
      setActiveJobs(transport.listJobs());
      // If the job was updated to completed, clear any pending timedOutJob for it
      if (
        job.status === "completed" ||
        job.status === "claimed" ||
        job.status === "disputed"
      ) {
        setTimedOutJob((prev) => (prev?.jobId === job.jobId ? null : prev));
      }
    });
    transport.setOnJobTimeout((job) => {
      setActiveJobs(transport.listJobs());
      setTimedOutJob(job);
    });
    transportRef.current = transport;
    return transport;
  }, [chatId, getGateway, resolveModelId, protocolChainId, publicClient]);

  /** Drop relay + in-memory state; keep sessionStorage for this chat. */
  const releaseTransport = useCallback(() => {
    transportRef.current?.release();
    transportRef.current = null;
    gatewayRef.current = null;
    resolvedModelIdRef.current = null;
    setStatus("idle");
    setError(null);
    setProgressStatus("idle");
    setActiveJobs([]);
    setTimedOutJob(null);
  }, []);

  /** Full teardown including persisted tab session (wallet change / disconnect). */
  const resetForWallet = useCallback(() => {
    transportRef.current?.destroy();
    transportRef.current = null;
    gatewayRef.current = null;
    resolvedModelIdRef.current = null;
    setStatus("idle");
    setError(null);
    setFailoverStatus("none");
    setProgressStatus("idle");
    setActiveJobs([]);
    setTimedOutJob(null);
  }, []);

  // Cleanup on unmount — preserve per-chat sessionStorage so revisiting the chat restores the session
  useEffect(() => {
    return () => {
      transportRef.current?.release();
      transportRef.current = null;
    };
  }, []);

  const retryFailover = useCallback(async () => {
    await transportRef.current?.retryFailover();
  }, []);

  const startNewSession = useCallback(() => {
    transportRef.current?.startNewSession();
    resetForWallet();
  }, [resetForWallet]);

  useEffect(() => {
    if (
      lastWalletAddressRef.current &&
      walletAddress &&
      lastWalletAddressRef.current !== walletAddress
    ) {
      resetForWallet();
    }

    if (lastWalletAddressRef.current && !walletAddress) {
      resetForWallet();
    }

    lastWalletAddressRef.current = walletAddress;
  }, [resetForWallet, walletAddress]);

  useEffect(() => {
    if (!chatId) return;
    releaseTransport();
  }, [chatId, releaseTransport]);

  const claimJobTimeout = useCallback(async (jobId: number) => {
    const transport = transportRef.current;
    if (!transport) throw new Error("No active transport");
    const result = await transport.claimJobTimeout(jobId);
    setActiveJobs(transport.listJobs());
    setTimedOutJob(null);
    return result;
  }, []);

  const disputeJob = useCallback(async (jobId: number) => {
    const transport = transportRef.current;
    if (!transport) throw new Error("No active transport");
    const result = await transport.disputeJob(jobId);
    setActiveJobs(transport.listJobs());
    return result;
  }, []);

  /**
   * Cryptographic dispute with the evidence captured at receipt. Only filable
   * while the page session that received the answer is alive — the ciphertext
   * is never persisted, so post-reload this throws and the caller should
   * steer the user to the bond dispute.
   */
  const disputeResponseMismatch = useCallback(async (jobId: number) => {
    const transport = transportRef.current;
    if (!transport) throw new Error("No active transport");
    const result = await transport.disputeResponseMismatch(jobId);
    setActiveJobs(transport.listJobs());
    return result;
  }, []);

  /** True while disputeResponseMismatch(jobId) can still be filed. */
  const hasMismatchEvidence = useCallback((jobId: number) => {
    return transportRef.current?.hasMismatchEvidence(jobId) ?? false;
  }, []);

  /**
   * Live-session share evidence (ciphertext + signature) for one job, or null
   * once the window has passed. Backs the verifiable-transcript export.
   */
  const getShareEvidence = useCallback((jobId: number) => {
    return transportRef.current?.getShareEvidence(jobId) ?? null;
  }, []);

  /**
   * Reads a job straight from the chain.
   *
   * The proof panel needs this rather than the tracked-job cache because that
   * cache only holds jobs from the current page load — a reloaded conversation
   * still has to be verifiable.
   */
  const fetchOnChainJob = useCallback(async (jobId: number) => {
    const transport = transportRef.current;
    if (!transport) return null;
    try {
      return await transport.getJob(jobId);
    } catch {
      return null;
    }
  }, []);

  /** Stake bonded behind a worker, for the proof panel. Null on failure. */
  const fetchWorkerStake = useCallback(async (worker: string) => {
    const transport = transportRef.current;
    if (!transport) return null;
    try {
      return await transport.getWorkerStake(worker);
    } catch {
      return null;
    }
  }, []);

  const clearTimedOutJob = useCallback(() => {
    setTimedOutJob(null);
  }, []);

  return {
    status,
    error,
    failoverStatus,
    workerCapabilities,
    progressStatus,
    activeJobs,
    timedOutJob,
    getTransport,
    // Exposed for the duel runner: side B needs the same authenticated
    // gateway client (SIWE-token auth) rather than a second one.
    getGateway,
    reset: resetForWallet,
    retryFailover,
    startNewSession,
    claimJobTimeout,
    disputeJob,
    disputeResponseMismatch,
    hasMismatchEvidence,
    getShareEvidence,
    fetchOnChainJob,
    fetchWorkerStake,
    clearTimedOutJob,
  };
}
