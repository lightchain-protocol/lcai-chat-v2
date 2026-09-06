"use client";

import type { PublicClient, WalletClient } from "viem";
import config from "@/config";
import { $http } from "@/lib/http";
import { GatewayAuth } from "./gateway-auth";
import { GatewayClient } from "./gateway-client";
import { ProtocolTransport } from "./transport";

/**
 * Builds a dedicated {@link ProtocolTransport} for one model of a multi-model
 * fan-out turn.
 *
 * Unlike the old compare transport (which deliberately left no trace in the
 * thread), this routes through the SAME persistence the single-model chat
 * uses: the user message is persisted here, and the assistant answer persists
 * itself from inside {@link ProtocolTransport} via
 * `RelayClient.completeAssistantMessage`. That is what makes a multi-model turn
 * save to history and reload as columns — the piece compare was missing.
 *
 * Every model in a turn shares one on-chain `chatId` and one user-message id, so
 * all N transports attempt to persist the same user row. The backend rejects a
 * duplicate id, so the first write creates the row and the rest are harmless
 * (swallowed) — and each transport's own assistant POST is still correctly
 * ordered behind its own user-message write. No cross-transport coordination is
 * needed.
 */
export function createMultiModelTransport(args: {
  /** Real bytes32 hex model id from useModels(). */
  modelId: string;
  /** The real chat id — shared by every model in the turn. */
  chatId: string;
  walletClient: WalletClient;
  publicClient: PublicClient;
  /** Device-local private-memory prefix, shared with the main chat. */
  getMemoryPrefix?: () => string;
  /**
   * Reads the current turn's group id at persist time. The transport stays warm
   * across turns, so a value captured at construction would stamp every later
   * turn's user row with the first turn's id.
   */
  getGroupId: () => string;
}): ProtocolTransport {
  const chainId = config.chains[0].id;
  const jobRegistryAddress = config.jobRegistryAddress[chainId];
  const aiConfigAddress = config.aiConfigAddress[chainId];
  const workerRegistryAddress = config.workerRegistryAddress[chainId];

  if (!jobRegistryAddress || jobRegistryAddress === "0x") {
    throw new Error(`JobRegistry address not configured for chain ${chainId}`);
  }
  if (!aiConfigAddress || aiConfigAddress === "0x") {
    throw new Error(`AIConfig address not configured for chain ${chainId}`);
  }
  if (!workerRegistryAddress || workerRegistryAddress === "0x") {
    throw new Error(
      `WorkerRegistry address not configured for chain ${chainId}`
    );
  }

  const gateway = new GatewayClient(undefined, new GatewayAuth());

  return new ProtocolTransport({
    gateway,
    modelId: args.modelId,
    // Namespaced per model so each model's session snapshot is independent and
    // survives across turns (kept warm for conversational context), without
    // colliding with the single-model chat's own per-chat session.
    sessionStorageKey: `lc-multi-session:${args.chatId}:${args.modelId}`,
    walletClient: args.walletClient,
    publicClient: args.publicClient,
    jobRegistryAddress,
    aiConfigAddress,
    workerRegistryAddress,
    relayUrl: process.env.NEXT_PUBLIC_RELAY_URL || "ws://localhost:8888/ws",
    getSubmitMode: () => "auto",
    getMemoryPrefix: args.getMemoryPrefix,
    persistence: {
      // Mirrors useProtocolSession's user-message persist (the proven body the
      // backend expects), plus the shared groupId so the row is traceable.
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
            ...(jobId != null ? { jobId } : {}),
            protocolMeta: {
              ...(jobId != null ? { jobId } : {}),
              sessionId,
              groupId: args.getGroupId(),
            },
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
}
