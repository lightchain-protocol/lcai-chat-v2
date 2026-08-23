"use client";

import { motion } from "framer-motion";
import { Check, Loader2, X } from "lucide-react";
import { memo, type ReactNode } from "react";
import type { SettlementProgress } from "@/lib/protocol/settlement";
import type { VerificationStatus } from "@/lib/protocol/verify-response";
import { cn } from "@/lib/utils";

/**
 * The answer's on-chain journey as a five-node stepper:
 * Escrow → Ack → Stream → Settle → Verify.
 *
 * Every lit node is backed by evidence recorded in `settlement` (see
 * lib/protocol/settlement.ts for what each field proves); the verify node is
 * the exception — it is driven by the render-time proof check and is never
 * persisted, so a stored timeline cannot fake a green check.
 *
 * Observatory language: the brand gradient marks the node whose evidence is
 * arriving right now (live proof); completed nodes are monochrome checks.
 */

type NodeState = "done" | "active" | "pending" | "failed";

type TimelineNode = {
  key: string;
  label: string;
  state: NodeState;
  /** Evidence note, e.g. "confirmed on chain" vs "frames flowing". */
  note?: string;
  /** Elapsed ms since escrow, when known. */
  elapsedMs?: number;
};

function buildNodes(
  settlement: SettlementProgress,
  verification: VerificationStatus | null,
  live: boolean
): TimelineNode[] {
  const anchor = settlement.escrowedAtMs;
  const elapsed = (atMs?: number) =>
    anchor !== undefined && atMs !== undefined ? atMs - anchor : undefined;

  const failed = settlement.stage === "failed";
  // The first node without evidence is where the journey stopped (or is now).
  let failureAssigned = false;
  const stateFor = (done: boolean): NodeState => {
    if (done) return "done";
    if (failed && !failureAssigned) {
      failureAssigned = true;
      return "failed";
    }
    return live ? "active" : "pending";
  };

  const escrowDone = settlement.escrowedAtMs !== undefined;
  const ackDone = settlement.acknowledgedAtMs !== undefined;
  const streamDone = settlement.firstFrameAtMs !== undefined;
  const settleDone = settlement.settledAtMs !== undefined;

  const nodes: TimelineNode[] = [
    {
      key: "escrow",
      label: "Escrowed",
      state: stateFor(escrowDone),
      note: settlement.escrowedFeeWei ? "fee locked on chain" : undefined,
      elapsedMs: 0,
    },
    {
      key: "ack",
      label: "Acknowledged",
      state: stateFor(ackDone),
      note: ackDone
        ? settlement.acknowledgedOnChain
          ? "confirmed on chain"
          : "worker frames received"
        : undefined,
      elapsedMs: elapsed(settlement.acknowledgedAtMs),
    },
    {
      key: "stream",
      label: "Streaming",
      state: stateFor(streamDone),
      note: streamDone ? "answer arriving" : undefined,
      elapsedMs: elapsed(settlement.firstFrameAtMs),
    },
    {
      key: "settle",
      label: "Settled",
      state: stateFor(settleDone),
      note: settleDone
        ? settlement.settledOnChainSec
          ? "completion committed on chain"
          : "terminal frame received"
        : undefined,
      elapsedMs: elapsed(settlement.settledAtMs),
    },
  ];

  // Verify is recomputed at render, never persisted. No proof on the message
  // (e.g. answers from before proof capture existed) is an honest "no
  // evidence" state, not a failure.
  const verifyState: NodeState = failed
    ? "pending"
    : verification === "verified"
      ? "done"
      : verification === "mismatch"
        ? "failed"
        : verification === null
          ? "pending"
          : live
            ? "active"
            : "pending";
  nodes.push({
    key: "verify",
    label: "Verified",
    state: verifyState,
    note:
      verification === "verified"
        ? "signature + hash checked in this browser"
        : verification === "mismatch"
          ? "does not match the chain"
          : verification === null
            ? "no proof captured for this answer"
            : "checked locally at render",
  });

  return nodes;
}

function NodeIcon({ state }: { state: NodeState }) {
  if (state === "done") return <Check size={10} strokeWidth={3} />;
  if (state === "failed") return <X size={10} strokeWidth={3} />;
  if (state === "active") return <Loader2 className="animate-spin" size={10} />;
  return null;
}

function PureSettlementTimeline({
  settlement,
  verification,
  live,
}: {
  settlement: SettlementProgress;
  verification: VerificationStatus | null;
  /** True while the response stream is still open. */
  live: boolean;
}) {
  const nodes = buildNodes(settlement, verification, live);

  return (
    <ol
      aria-label="Settlement timeline"
      className="flex items-stretch gap-0"
      data-testid="settlement-timeline"
    >
      {nodes.map((node, i) => (
        <li
          className="flex min-w-0 flex-1 flex-col items-center gap-1"
          key={node.key}
        >
          <div className="flex w-full items-center">
            {i > 0 && (
              <div
                className={cn(
                  "h-px flex-1",
                  nodes[i - 1].state === "done"
                    ? "bg-content-extraLight"
                    : "bg-border"
                )}
              />
            )}
            <motion.div
              animate={{ scale: 1, opacity: 1 }}
              className={cn(
                "flex size-4 shrink-0 items-center justify-center rounded-full border",
                node.state === "done" &&
                  "border-emerald-500/60 text-emerald-600 dark:text-emerald-400",
                node.state === "failed" &&
                  "border-red-500/60 text-red-600 dark:text-red-400",
                node.state === "active" &&
                  "border-transparent bg-gradient-primary text-white",
                node.state === "pending" &&
                  "border-border text-content-extraLight"
              )}
              initial={{ scale: 0.6, opacity: 0 }}
              transition={{ duration: 0.25 }}
            >
              <NodeIcon state={node.state} />
            </motion.div>
            {i < nodes.length - 1 && (
              <div
                className={cn(
                  "h-px flex-1",
                  node.state === "done" ? "bg-content-extraLight" : "bg-border"
                )}
              />
            )}
          </div>
          <div className="flex flex-col items-center gap-0.5 text-center">
            <span
              className={cn(
                "font-medium text-[10px] uppercase tracking-[0.08em]",
                node.state === "done" && "text-content-strong",
                node.state === "active" && "text-content-strong",
                node.state === "failed" && "text-red-600 dark:text-red-400",
                node.state === "pending" && "text-content-extraLight"
              )}
            >
              {node.label}
            </span>
            {(node.note || node.elapsedMs !== undefined) && (
              <span className="font-mono text-[10px] text-content-subtle leading-tight">
                {node.elapsedMs !== undefined && i > 0
                  ? `+${(node.elapsedMs / 1000).toFixed(1)}s`
                  : null}
                {node.note ? ` ${node.note}` : ""}
              </span>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

export const SettlementTimeline = memo(PureSettlementTimeline);

/** Wrapped in a fragment-friendly label for the failed reason, if any. */
export function SettlementFailureNote({
  settlement,
}: {
  settlement: SettlementProgress;
}): ReactNode {
  if (settlement.stage !== "failed" || !settlement.failedReason) return null;
  return (
    <p className="mt-1.5 text-content-subtle text-xs">
      {settlement.failedReason}
    </p>
  );
}
