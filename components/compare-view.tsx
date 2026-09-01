"use client";

import { AlertTriangle, Square, X } from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAccount } from "wagmi";
import {
  type ComparePane,
  useCompareSession,
} from "@/hooks/use-compare-session";
import { useModels } from "@/hooks/use-models";
import useWeb3Clients from "@/hooks/use-web3-clients";
import type { OnChainJob } from "@/lib/protocol/session";
import { AssistantAvatar } from "./assistant-answer";
import {
  AvailabilityDot,
  CompareModelMultiSelect,
  MIN_COMPARE_MODELS,
} from "./compare-model-picker";
import { MessageContent } from "./elements/message";
import {
  PromptInput,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputToolbar,
  PromptInputTools,
} from "./elements/prompt-input";
import { Response } from "./elements/response";
import { ArrowUpIcon } from "./icons";
import { MessageReasoning } from "./message-reasoning";
import { PipelineTimeline } from "./pipeline-timeline";
import { ProvenanceChip } from "./provenance-chip";
import { Button } from "./ui/button";

const STORAGE_KEY = "lc-compare-models";

/** Restores a previously-chosen selection so compare mode remembers the last set. */
function loadSelection(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === "string")
      : [];
  } catch {
    return [];
  }
}

/**
 * One answer column — the SAME building blocks as an assistant message in the
 * normal chat ({@link ./message.tsx}): the {@link AssistantAvatar}, the
 * {@link MessageContent} bubble wrapping {@link Response} for the markdown, the
 * {@link PipelineTimeline} standing in as the thinking indicator then collapsing
 * to a slim handle, and the shared {@link ProvenanceChip} for the settled/verify
 * verdict. It reads like a normal chat answer that happens to live in its own
 * column, distinguished only by a small, subtle model-name label on top.
 */
function PaneColumn({
  pane,
  explorerBaseUrl,
  fetchPaneJob,
  fetchPaneWorkerStake,
}: {
  pane: ComparePane;
  explorerBaseUrl?: string;
  fetchPaneJob: (
    paneChatId: string,
    jobId: number
  ) => Promise<OnChainJob | null>;
  fetchPaneWorkerStake: (
    paneChatId: string,
    worker: string
  ) => Promise<bigint | null>;
}) {
  const { paneChatId } = pane;
  const live = pane.status === "running";

  // Bind the chain reads to this pane's own transport, so the shared chip
  // verifies exactly as it does in the main chat.
  const fetchOnChainJob = useCallback(
    (jobId: number) => fetchPaneJob(paneChatId, jobId),
    [fetchPaneJob, paneChatId]
  );
  const fetchWorkerStake = useCallback(
    (worker: string) => fetchPaneWorkerStake(paneChatId, worker),
    [fetchPaneWorkerStake, paneChatId]
  );

  return (
    <div className="flex snap-center flex-col gap-2 rounded-xl border border-bdr-light bg-surface-elevation-light/40 p-3">
      {/* Subtle model-name label — compare's one addition over a chat answer. */}
      <div className="flex min-w-0 items-center gap-1.5">
        <AvailabilityDot modelId={pane.modelId} />
        <span className="truncate font-medium text-content-secondary text-xs">
          {pane.modelName}
        </span>
      </div>

      <div className="flex w-full items-start gap-2 md:gap-3">
        <AssistantAvatar />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {pane.error ? (
            <p className="flex items-center gap-1.5 text-red-600 text-sm dark:text-red-400">
              <AlertTriangle className="shrink-0" size={14} />
              <span className="min-w-0">{pane.error}</span>
            </p>
          ) : (
            <>
              {pane.reasoning && (
                <MessageReasoning isLoading={live} reasoning={pane.reasoning} />
              )}
              {pane.text && (
                <MessageContent className="bg-transparent px-0 py-0 text-left">
                  <Response>{pane.text}</Response>
                </MessageContent>
              )}
            </>
          )}

          {/* Per-job on-chain pipeline — the thinking indicator before the
              first token, then a slim handle. Placed where the main chat puts
              it, directly under the answer. */}
          <PipelineTimeline
            activeJobs={pane.jobs}
            chatId={paneChatId}
            explorerBaseUrl={explorerBaseUrl}
            firstTokenSeen={pane.firstTokenSeen}
            live={live}
            progressStatus={pane.progress}
          />

          {pane.jobId !== undefined && (
            <ProvenanceChip
              explorerBaseUrl={explorerBaseUrl}
              fallbackWorker={pane.jobs[0]?.worker}
              fetchOnChainJob={fetchOnChainJob}
              fetchWorkerStake={fetchWorkerStake}
              jobId={pane.jobId}
              live={live}
              metrics={null}
              proof={null}
              settlement={null}
              stats={null}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Compare mode — an additive, separate flow from the normal single-model chat.
 *
 * The user picks 2–4 live models, asks one question, and every answer streams
 * in parallel, side by side. Each column is a real, independent, on-chain job
 * (its own session, fresh relay token, its own paid settlement) rendered with
 * the SAME answer-presentation components as the normal chat — one design, laid
 * out in columns. See {@link useCompareSession} for the fan-out.
 */
export function CompareView({
  chatId,
  getMemoryPrefix,
  onBeforeSend,
  onExit,
  explorerBaseUrl,
}: {
  chatId: string;
  getMemoryPrefix?: () => string;
  /** Pre-send gate (wallet connected + prepaid ready); blocks the send if false. */
  onBeforeSend?: () => boolean;
  onExit: () => void;
  explorerBaseUrl?: string;
}) {
  const { models } = useModels();
  const { walletClient, publicClient } = useWeb3Clients();
  const { isConnected } = useAccount();

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [prompt, setPrompt] = useState("");

  const { panes, isRunning, run, stop, fetchPaneJob, fetchPaneWorkerStake } =
    useCompareSession({
      chatId,
      walletClient,
      publicClient,
      getMemoryPrefix,
    });

  // Restore last selection on mount.
  useEffect(() => {
    setSelectedIds(loadSelection());
  }, []);

  // A remembered id can go offline; keep only models still in the live list.
  const liveSelectedIds = useMemo(
    () => selectedIds.filter((id) => models.some((m) => m.id === id)),
    [selectedIds, models]
  );

  const updateSelection = useCallback((ids: string[]) => {
    setSelectedIds(ids);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
    } catch {
      // Private mode / quota — selection just won't persist.
    }
  }, []);

  const selectedModels = useMemo(
    () =>
      liveSelectedIds
        .map((id) => models.find((m) => m.id === id))
        .filter((m): m is { id: string; name: string } => m !== undefined),
    [liveSelectedIds, models]
  );

  const enoughModels = selectedModels.length >= MIN_COMPARE_MODELS;
  const canSend = enoughModels && prompt.trim().length > 0 && !isRunning;

  const handleSend = () => {
    if (!canSend) return;
    if (onBeforeSend && !onBeforeSend()) return;
    run({ prompt, models: selectedModels });
  };

  const columns = Math.max(panes.length || selectedModels.length || 1, 1);
  const hasResults = panes.length > 0;

  const compareLabel =
    selectedModels.length > 0
      ? `Compare ${selectedModels.length} models`
      : "Compare models";

  const exitButton = (
    <Button
      className="h-7 gap-1 px-2 text-content-subtle text-xs"
      onClick={onExit}
      size="sm"
      variant="ghost"
    >
      <X size={13} />
      Exit
    </Button>
  );

  // The composer — visually identical to the main chat's, differing only in
  // its contents: the multi-model dropdown stands where the single-model
  // picker sits, and the round gradient submit runs the fan-out.
  const composer = (
    <div className="flex w-full flex-col gap-2">
      <PromptInput
        className="border border-bdr-light p-3 transition-all duration-200 sm:p-4"
        onSubmit={(event) => {
          event.preventDefault();
          handleSend();
        }}
      >
        <div className="relative flex flex-row items-start gap-1 sm:gap-2">
          <div className="absolute top-[3px] border-surface-base-extraLight border-r pr-2 sm:top-0.5">
            <Image
              alt="Icon"
              height={16}
              src="/images/logo/favicon.png"
              width={16}
            />
          </div>
          <PromptInputTextarea
            autoFocus
            className="grow resize-none border-0! border-none! bg-transparent px-2 pt-0 pb-2 pl-8! text-sm outline-none ring-0 [-ms-overflow-style:none] [scrollbar-width:none] placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 [&::-webkit-scrollbar]:hidden"
            disableAutoResize={true}
            disabled={isRunning}
            maxHeight={200}
            minHeight={44}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={
              enoughModels
                ? "Ask all selected models the same question…"
                : `Select at least ${MIN_COMPARE_MODELS} models to compare`
            }
            rows={1}
            value={prompt}
          />
        </div>
        <PromptInputToolbar className="border-top-0! border-t-0! p-0 shadow-none dark:border-0 dark:border-transparent!">
          <PromptInputTools className="gap-0 sm:gap-0.5">
            <CompareModelMultiSelect
              disabled={isRunning}
              onChange={updateSelection}
              selectedIds={liveSelectedIds}
            />
          </PromptInputTools>

          {isRunning ? (
            <Button
              aria-label="Stop comparison"
              className="size-8 rounded-full bg-foreground p-1 text-background transition-colors hover:bg-foreground/90"
              onClick={stop}
              size="icon"
              type="button"
            >
              <Square size={13} />
            </Button>
          ) : (
            <PromptInputSubmit
              aria-label={compareLabel}
              className="size-8 rounded-full bg-gradient-primary text-white disabled:text-muted-foreground disabled:[background:#c1c1c1] dark:disabled:[background:#303030]"
              disabled={!canSend}
            >
              <ArrowUpIcon size={14} />
            </PromptInputSubmit>
          )}
        </PromptInputToolbar>
      </PromptInput>

      {/* Density-matched helper, folded into the composer footer. */}
      <p className="px-1 text-[11px] text-content-subtle">
        {isConnected
          ? "Each answer is a separate paid, verifiable job."
          : "Connect your wallet to run a comparison."}
      </p>
    </div>
  );

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col overflow-y-auto px-3 py-4 md:px-4">
      {hasResults ? (
        <div className="flex w-full flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-baseline gap-2">
              <h2 className="font-semibold text-content-strong text-sm">
                Compare models
              </h2>
              <span className="text-[11px] text-content-subtle">
                one prompt · {selectedModels.length || "N"} parallel on-chain
                jobs
              </span>
            </div>
            {exitButton}
          </div>

          {composer}

          {/* Columns on desktop, horizontal snap-scroll on mobile. Unchanged. */}
          <div
            className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 md:grid md:overflow-visible"
            style={{
              // Only takes effect in md:grid; ignored in the mobile flex row.
              gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
            }}
          >
            {panes.map((pane) => (
              <div
                className="w-[82vw] shrink-0 md:w-auto md:shrink"
                key={pane.paneChatId}
              >
                <PaneColumn
                  explorerBaseUrl={explorerBaseUrl}
                  fetchPaneJob={fetchPaneJob}
                  fetchPaneWorkerStake={fetchPaneWorkerStake}
                  pane={pane}
                />
              </div>
            ))}
          </div>
        </div>
      ) : (
        // Pre-results — mirrors the main chat's empty state: a subtle exit,
        // a centered hero, and the composer, all sitting comfortably centered.
        <div className="relative mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-8">
          <div className="absolute top-0 right-0">{exitButton}</div>
          <h2 className="text-center font-semibold text-2xl text-content-ultra md:text-3xl xl:text-4xl">
            Compare models
          </h2>
          {composer}
        </div>
      )}
    </div>
  );
}
