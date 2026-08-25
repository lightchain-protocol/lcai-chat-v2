"use client";

import { Check, Loader2, Wrench, X } from "lucide-react";
import {
  AGENT_SPEND_DEFAULTS,
  type AgentStep,
  buildAgentTimeline,
  spendSummary,
} from "@/lib/agent/timeline";
import type { ArtifactDescriptor } from "@/lib/protocol/artifact";
import { DELIVERED_NOT_SETTLED_LABEL } from "@/lib/protocol/artifact";
import { cn } from "@/lib/utils";

/**
 * Agent mode plan/progress surface (ai-1-agent-mode-design.md §3): the
 * consumer watches the worker's tool loop — this panel renders the
 * tool_call/tool_result artifact frames as a visible step timeline.
 *
 * Agent jobs themselves are Phase-2 contract-gated (the 120 s
 * completionTimeout can't fit a tool loop), so there is deliberately no
 * composer entry point; the timeline appears when agent frames arrive. The
 * spend counter is display-only against the design doc's envelope-v3
 * defaults, labeled as such. Like every artifact, steps are delivered, not
 * settled — the badge says so; only the final answer text settles on chain.
 */

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

function StepRow({ step }: { step: AgentStep }) {
  return (
    <li className="flex items-start gap-2.5">
      <span
        className={cn(
          "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full",
          step.state === "done" && "bg-emerald-500/10 text-emerald-500",
          step.state === "failed" && "bg-rose-500/10 text-rose-500",
          step.state === "running" && "bg-amber-500/10 text-amber-500"
        )}
      >
        {step.state === "done" && <Check className="size-3" />}
        {step.state === "failed" && <X className="size-3" />}
        {step.state === "running" && (
          <Loader2 className="size-3 animate-spin" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-x-2 text-content-default text-xs">
          <span className="font-medium font-mono">{step.tool}</span>
          <span className="text-content-light">#{step.callIndex}</span>
          {step.durationMs !== undefined && (
            <span className="text-content-light">
              {(step.durationMs / 1000).toFixed(1)}s
            </span>
          )}
          {(step.bytesIn !== undefined || step.bytesOut !== undefined) && (
            <span className="text-content-light">
              {formatBytes((step.bytesIn ?? 0) + (step.bytesOut ?? 0))}
            </span>
          )}
        </p>
        {step.state === "failed" && (
          <p className="mt-0.5 text-rose-500 text-xs">
            {step.error === "spend_guard"
              ? "Stopped by the spend guard — the settled answer is the partial result."
              : (step.error ?? "Tool call failed")}
          </p>
        )}
        {step.state === "running" && (
          <p className="mt-0.5 text-content-light text-xs">Running…</p>
        )}
        {step.arguments !== undefined && (
          <details className="mt-1 text-xs">
            <summary className="cursor-pointer text-content-light">
              Arguments
            </summary>
            <pre className="mt-1 max-h-32 overflow-auto rounded-lg bg-surface-base-faint p-2 font-mono text-content-subtle">
              {JSON.stringify(step.arguments, null, 2)}
            </pre>
          </details>
        )}
      </div>
    </li>
  );
}

export function AgentTimeline({
  descriptors,
  className,
}: {
  descriptors: ArtifactDescriptor[];
  className?: string;
}) {
  const steps = buildAgentTimeline(descriptors);
  if (steps.length === 0) {
    return null;
  }
  const spend = spendSummary(steps);
  const running = steps.some((s) => s.state === "running");

  return (
    <div
      className={cn("rounded-xl border border-bdr-light p-3", className)}
      data-testid="agent-timeline"
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 font-medium text-content-default text-xs">
          <Wrench className="size-3.5 text-content-soft" />
          Agent steps {running && "— in progress"}
        </span>
        <span
          className="text-[10px] text-content-subtle"
          title="Caps are the design doc's envelope-v3 defaults; the worker enforces them once agent mode ships"
        >
          {spend.calls}/{AGENT_SPEND_DEFAULTS.maxToolCalls} calls ·{" "}
          {formatBytes(spend.bytes)}/
          {formatBytes(AGENT_SPEND_DEFAULTS.maxToolBytes)} (defaults)
        </span>
        <span
          className="ml-auto rounded bg-muted px-1.5 py-0.5 text-[10px] text-content-secondary"
          title="Tool-call frames carry no on-chain commitment — only the final answer text settles"
        >
          {DELIVERED_NOT_SETTLED_LABEL}
        </span>
      </div>
      <ol className="flex flex-col gap-2.5">
        {steps.map((step) => (
          <StepRow key={step.id} step={step} />
        ))}
      </ol>
    </div>
  );
}
