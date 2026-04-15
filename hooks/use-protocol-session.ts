"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { WalletClient } from "viem";

import config from "@/config";
import useWeb3Clients from "@/hooks/use-web3-clients";
import { $http } from "@/lib/http";
import { GatewayAuth } from "@/lib/protocol/gateway-auth";
import { GatewayClient } from "@/lib/protocol/gateway-client";
import type { SessionStatus } from "@/lib/protocol/session";
import type { FailoverStatus } from "@/lib/protocol/transport";
import { ProtocolTransport } from "@/lib/protocol/transport";

/**
 * React hook that manages a LightChain protocol session.
 *
 * Lazily initializes on first use — session is created when getTransport()
 * is called (typically on first message send in chat.tsx).
 *
 * The local modelId (e.g. "chat-model") is resolved to the gateway's hex
 * model ID on first getTransport() call by fetching GET /api/models.
 */
export function useProtocolSession(
  modelId: string,
  walletClient: WalletClient | undefined,
  address: string | undefined,
  chatId: string
) {
  const [status, setStatus] = useState<SessionStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [failoverStatus, setFailoverStatus] = useState<FailoverStatus>("none");
  const transportRef = useRef<ProtocolTransport | null>(null);
  const gatewayRef = useRef<GatewayClient | null>(null);
  const resolvedModelIdRef = useRef<string | null>(null);
  const walletClientRef = useRef(walletClient);
  const addressRef = useRef(address);
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

  // Lazily create the gateway client — singleton per hook instance
  const getGateway = useCallback(() => {
    if (!gatewayRef.current) {
      const client = walletClientRef.current;
      // biome-ignore lint/nursery/noShadow: walletAddress is shadowed to avoid confusion
      const walletAddress = addressRef.current;
      const account = client?.account;
      if (client && walletAddress && account) {
        const gatewayBaseUrl = process.env.NEXT_PUBLIC_CONSUMER_API_URL;
        if (!gatewayBaseUrl) {
          throw new Error("Gateway URL not configured");
        }

        const auth = new GatewayAuth(
          // biome-ignore lint/performance/useTopLevelRegex: regex is used for path joining
          gatewayBaseUrl.replace(/\/+$/, ""),
          async (message) =>
            client.signMessage({
              account: account.address,
              message,
            }) as Promise<`0x${string}`>
        );
        gatewayRef.current = new GatewayClient(undefined, auth);
      } else {
        gatewayRef.current = new GatewayClient();
      }
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
      if (s === "error") {
        setError("Session initialization failed");
      } else {
        setError(null);
      }
    });
    transport.setOnFailoverStatus(setFailoverStatus);
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

  return {
    status,
    error,
    failoverStatus,
    getTransport,
    reset: resetForWallet,
    retryFailover,
    startNewSession,
  };
}
