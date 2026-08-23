/**
 * Duel side-B runner: drives the second model's answer for a multi-model duel.
 *
 * Per bc-2-duel-and-verifier-spec.md §1, a cross-model duel is two sessions
 * (a session pins modelId + worker at createSession), so side B gets its own
 * ProtocolTransport with its own session — storage-keyed per chat+model so a
 * repeat duel on the same pair reuses it instead of paying session creation
 * again. Side B never re-persists the user message (duelSkipUserPersist) and
 * never re-registers the chat's protocol session; its assistant answer
 * persists through the relay client's normal path into the same chat.
 *
 * The SSE stream is parsed here (data: {json}\n\n frames, the transport's own
 * emit format) and folded into progressive UIMessage snapshots by the AI SDK's
 * readUIMessageStream, so the duel pane streams like a normal answer.
 */

import { readUIMessageStream } from "ai";
import type { PublicClient, WalletClient } from "viem";
import config from "@/config";
import type { ChatMessage } from "@/lib/types";
import type { GatewayClient } from "./gateway-client";
import { ProtocolTransport } from "./transport";

export type DuelSideBInput = {
  chatId: string;
  /** Plain prompt text (voice/image attachments stay side-A-only for now). */
  prompt: string;
  /** Local friendly model id (e.g. "qwen3-8b") — resolved to hex via the gateway. */
  modelId: string;
  gateway: GatewayClient;
  walletClient: WalletClient;
  publicClient: PublicClient;
  /** Progressive assistant-message snapshots for the duel pane. */
  onMessage: (message: ChatMessage) => void;
  /** Same device-local memory as side A — same user, same envelope rules. */
  getMemoryPrefix?: () => string;
  signal?: AbortSignal;
};

/** Parses the transport's SSE wire format into a chunk object stream. */
function sseToChunkStream(
  body: ReadableStream<Uint8Array>
): ReadableStream<Record<string, unknown>> {
  return new ReadableStream<Record<string, unknown>>({
    async start(controller) {
      const reader = body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";
          for (const frame of frames) {
            const line = frame.trim();
            if (!line.startsWith("data:")) continue;
            try {
              controller.enqueue(JSON.parse(line.slice(5)));
            } catch {
              // A malformed SSE frame is skipped, never fatal to the duel pane.
            }
          }
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
}

export async function runDuelSideB(input: DuelSideBInput): Promise<void> {
  const { models } = await input.gateway.getModels();
  const lower = input.modelId.toLowerCase();
  const match = models.find((m) => m.name.toLowerCase().includes(lower));
  const hexModelId = match?.id ?? models[0]?.id;
  if (!hexModelId) throw new Error("No models available from gateway");

  const chainId = config.chains[0].id;
  const jobRegistryAddress = config.jobRegistryAddress[chainId];
  const aiConfigAddress = config.aiConfigAddress[chainId];
  const workerRegistryAddress = config.workerRegistryAddress[chainId];
  if (!jobRegistryAddress || !aiConfigAddress || !workerRegistryAddress) {
    throw new Error(`Protocol contracts not configured for chain ${chainId}`);
  }

  const transport = new ProtocolTransport({
    gateway: input.gateway,
    modelId: hexModelId,
    sessionStorageKey: `lc-protocol-session:${input.chatId}:duel:${input.modelId}`,
    walletClient: input.walletClient,
    publicClient: input.publicClient,
    jobRegistryAddress,
    aiConfigAddress,
    workerRegistryAddress,
    relayUrl: process.env.NEXT_PUBLIC_RELAY_URL || "ws://localhost:8888/ws",
    getSubmitMode: () => "auto",
    getMemoryPrefix: input.getMemoryPrefix,
    // Side B must not overwrite the chat's primary-session record.
    registerProtocolSession: async () => {
      /* deliberate no-op — the primary session record stays side A's */
      await Promise.resolve();
    },
    persistence: {
      // Never fires (duelSkipUserPersist) but the config shape requires it.
      persistUserMessage: async () => {
        /* deliberate no-op — see duelSkipUserPersist */
        await Promise.resolve();
      },
    },
  });

  try {
    const { response } = await transport.sendMessages({
      messages: [
        {
          role: "user",
          parts: [{ type: "text", text: input.prompt }],
        },
      ],
      body: {
        id: input.chatId,
        duelSkipUserPersist: true,
        selectedVisibilityType: "private",
      },
      signal: input.signal,
    });

    if (!response.body) throw new Error("Duel stream had no body");

    const messageStream = readUIMessageStream<ChatMessage>({
      stream: sseToChunkStream(response.body) as never,
    });
    for await (const message of messageStream) {
      input.onMessage(message);
    }
  } finally {
    // The session row is keyed per chat+model and reused on the next duel;
    // only the transport instance is disposable.
    transport.destroy();
  }
}
