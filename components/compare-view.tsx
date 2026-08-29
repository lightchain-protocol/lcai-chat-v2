"use client";

import { ArrowUp, Square, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAccount } from "wagmi";
import {
  type ComparePane,
  useCompareSession,
} from "@/hooks/use-compare-session";
import { useModels } from "@/hooks/use-models";
import useWeb3Clients from "@/hooks/use-web3-clients";
import { cn } from "@/lib/utils";
import {
  AvailabilityDot,
  CompareModelPicker,
  MIN_COMPARE_MODELS,
} from "./compare-model-picker";
import { Response } from "./elements/response";
import { PipelineTimeline } from "./pipeline-timeline";
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

const STATUS_LABEL: Record<ComparePane["status"], string> = {
  running: "Running",
  done: "Done",
  error: "Error",
};

function PaneCard({
  pane,
  explorerBaseUrl,
}: {
  pane: ComparePane;
  explorerBaseUrl?: string;
}) {
  const live = pane.status === "running";
  return (
    <div className="flex min-h-[240px] snap-center flex-col overflow-hidden rounded-xl border border-border bg-surface-base-faint/40">
      <div className="flex items-center justify-between gap-2 border-border border-b bg-background/60 px-3 py-2">
        <span className="flex min-w-0 items-center gap-1.5">
          <AvailabilityDot modelId={pane.modelId} />
          <span className="truncate font-medium text-content-strong text-sm">
            {pane.modelName}
          </span>
        </span>
        <span
          className={cn(
            "shrink-0 rounded-full px-1.5 py-0.5 font-medium text-[10px] uppercase tracking-wide",
            pane.status === "done" &&
              "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
            pane.status === "error" &&
              "bg-red-500/10 text-red-600 dark:text-red-400",
            pane.status === "running" && "bg-primary/10 text-primary"
          )}
        >
          {STATUS_LABEL[pane.status]}
        </span>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-2 px-3 py-2.5">
        {pane.error ? (
          <p className="rounded-lg border border-red-500/30 bg-red-500/5 px-2.5 py-2 text-red-600 text-xs dark:text-red-400">
            {pane.error}
          </p>
        ) : (
          <>
            {pane.reasoning && (
              <details className="rounded-lg border border-border bg-background/40 px-2.5 py-1.5">
                <summary className="cursor-pointer text-[11px] text-content-secondary">
                  Reasoning
                </summary>
                <p className="mt-1 whitespace-pre-wrap text-[11px] text-content-subtle">
                  {pane.reasoning}
                </p>
              </details>
            )}
            {pane.text && (
              <div className="min-w-0 break-words text-sm">
                <Response>{pane.text}</Response>
              </div>
            )}
          </>
        )}

        {/* Per-job on-chain pipeline + verification. Stands in as the thinking
            indicator before the first token, then collapses to a slim handle. */}
        <div className="mt-auto pt-1">
          <PipelineTimeline
            activeJobs={pane.jobs}
            chatId={pane.paneChatId}
            explorerBaseUrl={explorerBaseUrl}
            firstTokenSeen={pane.firstTokenSeen}
            live={live}
            progressStatus={pane.progress}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Compare mode — an additive, separate flow from the normal single-model chat.
 *
 * The user picks 2–4 live models, asks one question, and every answer streams
 * in parallel, side by side. Each pane is a real, independent, on-chain job
 * (its own session, fresh relay token, its own paid settlement), so the mode
 * is labelled as N paid jobs. See {@link useCompareSession} for the fan-out.
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

  const { panes, isRunning, run, stop } = useCompareSession({
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

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-3 overflow-y-auto px-3 py-3 md:px-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <h2 className="font-semibold text-content-strong text-sm">
            Compare models
          </h2>
          <span className="text-[11px] text-content-subtle">
            one prompt · {selectedModels.length || "N"} parallel on-chain jobs
          </span>
        </div>
        <Button
          className="h-7 gap-1 px-2 text-xs"
          onClick={onExit}
          size="sm"
          variant="ghost"
        >
          <X size={13} />
          Exit
        </Button>
      </div>

      <div className="rounded-xl border border-border bg-surface-base-faint/30 p-3">
        <CompareModelPicker
          disabled={isRunning}
          onChange={updateSelection}
          selectedIds={liveSelectedIds}
        />
      </div>

      {/* Composer */}
      <div className="flex flex-col gap-2 rounded-xl border border-border bg-background p-2.5">
        <textarea
          className="max-h-40 min-h-[52px] w-full resize-none bg-transparent px-1.5 py-1 text-sm outline-none placeholder:text-content-subtle"
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder={
            enoughModels
              ? "Ask all selected models the same question…"
              : `Select at least ${MIN_COMPARE_MODELS} models to compare`
          }
          value={prompt}
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-content-subtle">
            {isConnected
              ? "Each answer is a separate paid, verifiable job."
              : "Connect your wallet to run a comparison."}
          </span>
          {isRunning ? (
            <Button
              className="h-8 gap-1.5 px-3"
              onClick={stop}
              size="sm"
              variant="outline"
            >
              <Square size={13} />
              Stop
            </Button>
          ) : (
            <Button
              className="h-8 gap-1.5 px-3"
              disabled={!canSend}
              onClick={handleSend}
              size="sm"
            >
              <ArrowUp size={14} />
              Compare {selectedModels.length > 0 ? selectedModels.length : ""}
            </Button>
          )}
        </div>
      </div>

      {/* Panes: columns on desktop, horizontal snap-scroll on mobile. */}
      {panes.length > 0 && (
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
              <PaneCard explorerBaseUrl={explorerBaseUrl} pane={pane} />
            </div>
          ))}
        </div>
      )}

      {panes.length === 0 && (
        <p className="px-1 py-6 text-center text-content-subtle text-xs">
          Pick your models and ask a question — answers stream in side by side,
          each an independent on-chain job you can verify.
        </p>
      )}
    </div>
  );
}
