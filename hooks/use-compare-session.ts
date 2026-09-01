"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PublicClient, WalletClient } from "viem";
import { recordModelOutcome } from "@/lib/ai/availability";
import { createCompareTransport } from "@/lib/protocol/compare-transport";
import type { OnChainJob } from "@/lib/protocol/session";
import type { ProtocolTransport, TrackedJob } from "@/lib/protocol/transport";
import type { ProtocolLoadingStatus } from "@/lib/types";

/** One selected model to compare, as it comes from useModels(). */
export type CompareModel = { id: string; name: string };

export type ComparePaneStatus = "running" | "done" | "error";

/**
 * Live state for one side-by-side pane. `jobs` is that pane's transport's
 * tracked-job snapshot, fed straight into <PipelineTimeline> so the on-chain
 * steps + verification render per job.
 */
export type ComparePane = {
  modelId: string;
  modelName: string;
  /** Synthetic per-pane chat id the PipelineTimeline latches its job onto. */
  paneChatId: string;
  status: ComparePaneStatus;
  progress: ProtocolLoadingStatus;
  /** The answer text streamed so far. */
  text: string;
  /** Reasoning/thinking channel, if the model streams it. */
  reasoning: string;
  /** True once the first answer token has rendered (drives the timeline). */
  firstTokenSeen: boolean;
  jobs: TrackedJob[];
  /**
   * On-chain job id for this pane, once the relay binds it. Feeds the shared
   * {@link ProvenanceChip} the same way message metadata does in the main chat.
   */
  jobId?: number;
  error: string | null;
};

type RunArgs = {
  prompt: string;
  models: CompareModel[];
  searchEnabled?: boolean;
};

/**
 * Drives compare mode: one prompt fanned out to N independent protocol jobs,
 * one per selected model, each on its own transport with a fresh relay token,
 * subscribe-before-submit, streaming.
 *
 * The N jobs are fired CONCURRENTLY — `run` maps the selection to
 * `streamComparison` promises without awaiting between them, so they claim,
 * submit, and stream in parallel. A pane that errors or times out settles on
 * its own; it never blocks the others.
 *
 * Nothing here touches the main chat thread: compare transports use a no-op
 * persistence hook, so no messages are written to the chat database.
 */
export function useCompareSession(args: {
  chatId: string;
  walletClient: WalletClient | undefined;
  publicClient: PublicClient;
  getMemoryPrefix?: () => string;
}) {
  const { chatId, walletClient, publicClient, getMemoryPrefix } = args;

  const [panes, setPanes] = useState<ComparePane[]>([]);
  const [isRunning, setIsRunning] = useState(false);

  // Live transports + abort handles, keyed by pane chat id, so a re-run or an
  // unmount can tear the previous batch down cleanly.
  const transportsRef = useRef<Map<string, ProtocolTransport>>(new Map());
  const abortRef = useRef<Map<string, AbortController>>(new Map());

  const paneChatIdFor = useCallback(
    (modelId: string) => `compare:${chatId}:${modelId}`,
    [chatId]
  );

  const updatePane = useCallback(
    (paneChatId: string, patch: Partial<ComparePane>) => {
      setPanes((prev) =>
        prev.map((p) => (p.paneChatId === paneChatId ? { ...p, ...patch } : p))
      );
    },
    []
  );

  const teardown = useCallback(() => {
    for (const controller of abortRef.current.values()) {
      controller.abort();
    }
    abortRef.current.clear();
    for (const transport of transportsRef.current.values()) {
      // Full teardown — a compare job is one-shot, so the session is not reused.
      transport.destroy();
    }
    transportsRef.current.clear();
  }, []);

  const stop = useCallback(() => {
    teardown();
    setIsRunning(false);
    setPanes((prev) =>
      prev.map((p) =>
        p.status === "running"
          ? { ...p, status: "error", error: "Stopped", progress: "idle" }
          : p
      )
    );
  }, [teardown]);

  const reset = useCallback(() => {
    teardown();
    setIsRunning(false);
    setPanes([]);
  }, [teardown]);

  // Chain reads for the shared ProvenanceChip, bound to a pane's own transport
  // (each pane is an independent session). Mirror the main chat's
  // fetchOnChainJob/fetchWorkerStake, so the chip verifies compare answers with
  // the very same code path. Null once a pane's transport has been torn down.
  const fetchPaneJob = useCallback(
    async (paneChatId: string, jobId: number): Promise<OnChainJob | null> => {
      const transport = transportsRef.current.get(paneChatId);
      if (!transport) return null;
      try {
        return await transport.getJob(jobId);
      } catch {
        return null;
      }
    },
    []
  );

  const fetchPaneWorkerStake = useCallback(
    async (paneChatId: string, worker: string): Promise<bigint | null> => {
      const transport = transportsRef.current.get(paneChatId);
      if (!transport) return null;
      try {
        return await transport.getWorkerStake(worker);
      } catch {
        return null;
      }
    },
    []
  );

  const run = useCallback(
    ({ prompt, models, searchEnabled }: RunArgs) => {
      const trimmed = prompt.trim();
      if (!trimmed || models.length === 0) return;
      if (!walletClient?.account) return;

      // Drop any previous batch before starting a new one.
      teardown();

      const initial: ComparePane[] = models.map((m) => ({
        modelId: m.id,
        modelName: m.name,
        paneChatId: paneChatIdFor(m.id),
        status: "running",
        progress: "preparing_chat",
        text: "",
        reasoning: "",
        firstTokenSeen: false,
        jobs: [],
        error: null,
      }));
      setPanes(initial);
      setIsRunning(true);

      const promises = models.map((model) => {
        const paneChatId = paneChatIdFor(model.id);
        const controller = new AbortController();
        abortRef.current.set(paneChatId, controller);

        const transport = createCompareTransport({
          modelId: model.id,
          paneChatId,
          walletClient,
          publicClient,
          getMemoryPrefix,
        });
        transportsRef.current.set(paneChatId, transport);

        // Per-pane progress + tracked jobs flow through the transport's own
        // callbacks; both are read straight into the pane for its timeline.
        transport.setOnProgressStatus((progress) =>
          updatePane(paneChatId, { progress })
        );
        transport.setOnJobUpdate(() =>
          updatePane(paneChatId, { jobs: transport.listJobs() })
        );

        // Fired without awaiting — this is what keeps the N jobs concurrent.
        return transport
          .streamComparison(
            trimmed,
            paneChatId,
            {
              onJobId: (jobId) => updatePane(paneChatId, { jobId }),
              onReset: () =>
                updatePane(paneChatId, { text: "", firstTokenSeen: false }),
              onFirstToken: () =>
                updatePane(paneChatId, { firstTokenSeen: true }),
              onToken: (delta) =>
                setPanes((prev) =>
                  prev.map((p) =>
                    p.paneChatId === paneChatId
                      ? { ...p, text: p.text + delta }
                      : p
                  )
                ),
              onReasoning: (delta) =>
                setPanes((prev) =>
                  prev.map((p) =>
                    p.paneChatId === paneChatId
                      ? { ...p, reasoning: p.reasoning + delta }
                      : p
                  )
                ),
              onComplete: (fullText) => {
                // The terminal frame is authoritative — render exactly it.
                updatePane(paneChatId, {
                  text: fullText,
                  firstTokenSeen: fullText.trim().length > 0,
                  status: "done",
                  progress: "completed",
                });
                recordModelOutcome(model.id, "completed");
              },
              onError: (message) => {
                updatePane(paneChatId, {
                  status: "error",
                  error: message,
                  progress: "error",
                });
                recordModelOutcome(model.id, "failed");
              },
            },
            { signal: controller.signal, searchEnabled }
          )
          .catch(() => {
            // onError already surfaced the message to the pane; swallow so
            // one failed pane never rejects the whole batch.
          });
      });

      Promise.allSettled(promises).then(() => setIsRunning(false));
    },
    [
      walletClient,
      publicClient,
      getMemoryPrefix,
      paneChatIdFor,
      teardown,
      updatePane,
    ]
  );

  // Tear everything down on unmount so no relay socket outlives the view.
  useEffect(() => teardown, [teardown]);

  return {
    panes,
    isRunning,
    run,
    stop,
    reset,
    fetchPaneJob,
    fetchPaneWorkerStake,
  };
}
