"use client";

import type { UseChatHelpers } from "@ai-sdk/react";
import {
  parseJsonEventStream,
  readUIMessageStream,
  uiMessageChunkSchema,
} from "ai";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PublicClient, WalletClient } from "viem";
import { recordModelOutcome } from "@/lib/ai/availability";
import { friendlyProtocolError } from "@/lib/protocol/friendly-error";
import { createMultiModelTransport } from "@/lib/protocol/multi-model-transport";
import type { ProtocolTransport, TrackedJob } from "@/lib/protocol/transport";
import type { ChatMessage, ProtocolLoadingStatus } from "@/lib/types";

/** One model selected for a fan-out turn, as it comes from useModels(). */
export type MultiModel = { id: string; name: string };

/**
 * Live, transient status of one column while its job is in flight. Keyed by the
 * placeholder assistant row's id. After a reload there is no live status — the
 * persisted parts (settlement, proof) carry provenance instead, and the
 * per-column timeline collapses to nothing.
 */
export type MultiModelLiveStatus = {
  /** True while this column's job is still streaming. */
  live: boolean;
  progress: ProtocolLoadingStatus;
  /** This model's own transport's tracked jobs (feeds the column timeline). */
  jobs: TrackedJob[];
  /** True once the first answer/reasoning token has rendered. */
  firstTokenSeen: boolean;
  error: string | null;
};

export type MultiModelLive = Record<string, MultiModelLiveStatus>;

type RunArgs = {
  /** The single shared user message (already assigned a stable id). */
  userMessage: ChatMessage;
  models: MultiModel[];
  /** The per-turn id every sibling row shares. */
  groupId: string;
  enableWebSearch?: boolean;
  systemPrompt?: string | null;
  selectedVisibilityType?: string;
};

/** The placeholder assistant row id for a model within a turn. */
export function multiModelRowId(groupId: string, modelId: string): string {
  return `${groupId}::${modelId}`;
}

/**
 * Drives a multi-model turn: one prompt fanned out to N on-chain jobs, one per
 * selected model, each streamed into the SAME `useChat` message list as its own
 * sibling assistant row (stable id, shared groupId, its own protocolMeta.model).
 *
 * Each model runs through the NORMAL {@link ProtocolTransport.sendMessages}
 * path, so `RelayClient.beginAssistantMessage`/`completeAssistantMessage`
 * persist every answer — the whole turn saves to history and reloads as columns.
 * Incremental UI is driven by `setMessages`: the transport's SSE Response is
 * parsed back into UIMessage parts (via the AI SDK's own stream reader) and
 * merged onto the placeholder row.
 *
 * Transports are kept warm per model across turns (conversational context), and
 * torn down on unmount or when the wallet/chat changes.
 */
export function useMultiModelSession(args: {
  chatId: string;
  walletClient: WalletClient | undefined;
  publicClient: PublicClient;
  address: string | undefined;
  getMemoryPrefix?: () => string;
  setMessages: UseChatHelpers<ChatMessage>["setMessages"];
  /** Fired once every column of a turn has settled (refresh history/balance). */
  onFinish?: () => void;
}) {
  const {
    chatId,
    walletClient,
    publicClient,
    address,
    getMemoryPrefix,
    setMessages,
    onFinish,
  } = args;

  // Ref so `run` can call the latest onFinish without being re-created (and
  // re-appending listeners) whenever the callback identity changes.
  const onFinishRef = useRef(onFinish);
  useEffect(() => {
    onFinishRef.current = onFinish;
  }, [onFinish]);

  const [isRunning, setIsRunning] = useState(false);
  const [live, setLive] = useState<MultiModelLive>({});

  // Warm transports, keyed by model id, reused across turns for context.
  const transportsRef = useRef<Map<string, ProtocolTransport>>(new Map());
  // The current turn's group id, read by each transport at persist time.
  const groupIdRef = useRef("");
  // In-flight aborts, keyed by placeholder row id, cleared each run.
  const abortRef = useRef<Map<string, AbortController>>(new Map());
  // The (chat, wallet) the warm transports belong to; a change tears them down.
  const ownerKeyRef = useRef<string>(`${chatId}::${address ?? ""}`);

  const teardownTransports = useCallback(() => {
    for (const controller of abortRef.current.values()) {
      controller.abort();
    }
    abortRef.current.clear();
    for (const transport of transportsRef.current.values()) {
      transport.destroy();
    }
    transportsRef.current.clear();
  }, []);

  // Rebuild warm transports when the wallet or chat changes — a session bound
  // to a different signer/chat can never serve this one.
  useEffect(() => {
    const nextKey = `${chatId}::${address ?? ""}`;
    if (ownerKeyRef.current !== nextKey) {
      ownerKeyRef.current = nextKey;
      teardownTransports();
    }
  }, [chatId, address, teardownTransports]);

  // Tear everything down on unmount so no relay socket outlives the view.
  useEffect(() => () => teardownTransports(), [teardownTransports]);

  const patchLive = useCallback(
    (rowId: string, patch: Partial<MultiModelLiveStatus>) => {
      setLive((prev) => {
        const current = prev[rowId];
        if (!current) return prev;
        return { ...prev, [rowId]: { ...current, ...patch } };
      });
    },
    []
  );

  const getTransport = useCallback(
    (model: MultiModel): ProtocolTransport => {
      const existing = transportsRef.current.get(model.id);
      if (existing) return existing;
      if (!walletClient) {
        throw new Error("Wallet not connected");
      }
      const transport = createMultiModelTransport({
        modelId: model.id,
        chatId,
        walletClient,
        publicClient,
        getMemoryPrefix,
        getGroupId: () => groupIdRef.current,
      });
      transportsRef.current.set(model.id, transport);
      return transport;
    },
    [chatId, walletClient, publicClient, getMemoryPrefix]
  );

  /** Merge the progressively-built UIMessage's parts onto its placeholder row. */
  const mergeRow = useCallback(
    (rowId: string, streamed: ChatMessage) => {
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== rowId) return m;
          const metaPart = streamed.parts.find(
            (p) => p.type === "data-protocolMeta"
          );
          const pm = (metaPart && "data" in metaPart ? metaPart.data : null) as
            | Record<string, unknown>
            | null
            | undefined;
          const jobId =
            pm && typeof pm.jobId === "number" ? pm.jobId : m.metadata?.jobId;
          return {
            ...m,
            parts: streamed.parts,
            metadata: {
              ...m.metadata,
              createdAt: m.metadata?.createdAt ?? new Date().toISOString(),
              ...(jobId != null ? { jobId } : {}),
              protocolMeta: {
                ...(m.metadata?.protocolMeta ?? {}),
                ...(pm ?? {}),
              },
            },
          };
        })
      );
    },
    [setMessages]
  );

  const streamModel = useCallback(
    async (
      model: MultiModel,
      rowId: string,
      runArgs: RunArgs
    ): Promise<void> => {
      const controller = new AbortController();
      abortRef.current.set(rowId, controller);

      let transport: ProtocolTransport;
      try {
        transport = getTransport(model);
      } catch (err) {
        patchLive(rowId, {
          live: false,
          error: friendlyProtocolError(err, model.name),
          progress: "error",
        });
        return;
      }

      transport.setOnProgressStatus((progress) =>
        patchLive(rowId, { progress })
      );
      transport.setOnJobUpdate(() =>
        patchLive(rowId, { jobs: transport.listJobs() })
      );

      try {
        const { response } = await transport.sendMessages({
          // The full user message, INCLUDING its id — the transport's user-row
          // persist keys off message.id so all N models write (and dedupe) the
          // same row rather than N different ones.
          messages: [
            {
              id: runArgs.userMessage.id,
              role: runArgs.userMessage.role,
              parts: runArgs.userMessage.parts as Array<{
                type: string;
                text?: string;
              }>,
            },
          ],
          body: {
            id: chatId,
            groupId: runArgs.groupId,
            friendlyModelId: model.name,
            enableWebSearch: runArgs.enableWebSearch === true,
            systemPrompt: runArgs.systemPrompt ?? null,
            selectedVisibilityType: runArgs.selectedVisibilityType,
          },
          signal: controller.signal,
        });

        if (!response.body) {
          throw new Error("Empty response stream");
        }

        // The transport returns the SAME SSE UI-message stream DefaultChatTransport
        // consumes; parse it back into UIMessage parts with the SDK's own reader
        // rather than re-implementing the reducer.
        const chunks = parseJsonEventStream({
          stream: response.body,
          schema: uiMessageChunkSchema,
        }).pipeThrough(
          new TransformStream({
            transform(part, out) {
              if (!part.success) {
                throw part.error;
              }
              out.enqueue(part.value);
            },
          })
        );

        let sawError: string | null = null;
        for await (const streamed of readUIMessageStream<ChatMessage>({
          stream: chunks,
          onError: (err) => {
            sawError = err instanceof Error ? err.message : String(err);
          },
        })) {
          mergeRow(rowId, streamed);
          const hasContent = streamed.parts.some(
            (p) =>
              (p.type === "text" || p.type === "reasoning") &&
              typeof p.text === "string" &&
              p.text.trim().length > 0
          );
          if (hasContent) {
            patchLive(rowId, { firstTokenSeen: true });
          }
        }

        if (sawError) {
          patchLive(rowId, { live: false, error: sawError, progress: "error" });
          recordModelOutcome(model.id, "failed");
          return;
        }

        patchLive(rowId, { live: false, progress: "completed" });
        recordModelOutcome(model.id, "completed");
      } catch (err) {
        const isAbort =
          err instanceof DOMException && err.name === "AbortError";
        patchLive(rowId, {
          live: false,
          progress: isAbort ? "idle" : "error",
          error: isAbort ? "Stopped" : friendlyProtocolError(err, model.name),
        });
        if (!isAbort) {
          recordModelOutcome(model.id, "failed");
        }
      } finally {
        abortRef.current.delete(rowId);
      }
    },
    [chatId, getTransport, patchLive, mergeRow]
  );

  const run = useCallback(
    (runArgs: RunArgs) => {
      const { userMessage, models, groupId } = runArgs;
      if (models.length < 2) return;
      if (!walletClient?.account) return;
      groupIdRef.current = groupId;

      // Append the one user bubble + one placeholder assistant row per model.
      const now = new Date().toISOString();
      const placeholders: ChatMessage[] = models.map((model) => ({
        id: multiModelRowId(groupId, model.id),
        role: "assistant",
        parts: [],
        metadata: {
          createdAt: now,
          groupId,
          protocolMeta: { model: model.name, groupId },
        },
      }));
      setMessages((prev) => [...prev, userMessage, ...placeholders]);

      const initialLive: MultiModelLive = {};
      for (const model of models) {
        initialLive[multiModelRowId(groupId, model.id)] = {
          live: true,
          progress: "preparing_chat",
          jobs: [],
          firstTokenSeen: false,
          error: null,
        };
      }
      setLive(initialLive);
      setIsRunning(true);

      const runs = models.map((model) =>
        streamModel(model, multiModelRowId(groupId, model.id), runArgs)
      );
      Promise.allSettled(runs).then(() => {
        setIsRunning(false);
        onFinishRef.current?.();
      });
    },
    [walletClient, setMessages, streamModel]
  );

  const stop = useCallback(() => {
    for (const controller of abortRef.current.values()) {
      controller.abort();
    }
    abortRef.current.clear();
    setIsRunning(false);
    setLive((prev) => {
      const next: MultiModelLive = {};
      for (const [rowId, status] of Object.entries(prev)) {
        next[rowId] = status.live
          ? { ...status, live: false, progress: "idle" }
          : status;
      }
      return next;
    });
  }, []);

  return { run, stop, isRunning, live };
}
