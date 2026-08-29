"use client";

import type { PublicClient, WalletClient } from "viem";
import config from "@/config";
import { GatewayAuth } from "./gateway-auth";
import { GatewayClient } from "./gateway-client";
import { ProtocolTransport } from "./transport";

/**
 * Builds a dedicated {@link ProtocolTransport} for a single compare-mode pane.
 *
 * Each pane runs a real, independent, on-chain-verifiable job on its own
 * model, so each gets its own transport (and therefore its own session, relay
 * socket, and freshly-minted relay token — driven by
 * `ProtocolTransport.streamComparison`). This mirrors the wiring in
 * `useProtocolSession.getTransport`, minus the chat-database persistence: a
 * compare job deliberately leaves no trace in the normal thread, so the
 * persistence hook is a no-op and there is no protocol-session registration.
 *
 * The heavy config resolution (registry addresses, relay URL, submit mode)
 * matches the main chat exactly so a pane talks to the same contracts and
 * relay the single-model chat does.
 */
export function createCompareTransport(args: {
  /** Real bytes32 hex model id from useModels(). */
  modelId: string;
  /** Synthetic per-pane chat id, e.g. `compare:<chatId>:<modelId>`. */
  paneChatId: string;
  walletClient: WalletClient;
  publicClient: PublicClient;
  /** Device-local private-memory prefix, shared with the main chat. */
  getMemoryPrefix?: () => string;
}): ProtocolTransport {
  // Protocol always targets the first configured chain (matching the main chat
  // session/transport), regardless of the wallet's connected chain.
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
    // Namespaced so a pane's session snapshot never collides with the main
    // chat's per-chat session in sessionStorage.
    sessionStorageKey: `lc-compare-session:${args.paneChatId}`,
    walletClient: args.walletClient,
    publicClient: args.publicClient,
    jobRegistryAddress,
    aiConfigAddress,
    workerRegistryAddress,
    relayUrl: process.env.NEXT_PUBLIC_RELAY_URL || "ws://localhost:8888/ws",
    // Same auto (prepaid-if-ready, else wallet) mode the main chat uses.
    getSubmitMode: () => "auto",
    getMemoryPrefix: args.getMemoryPrefix,
    persistence: {
      // Compare mode leaves no trace in the chat database — the panes render
      // their own transient state and nothing is written to the thread.
      persistUserMessage: async () => {
        // no-op
      },
    },
  });
}
