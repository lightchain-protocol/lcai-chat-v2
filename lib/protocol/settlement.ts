/**
 * Settlement timeline state for one assistant answer.
 *
 * The answer's journey has five externally meaningful milestones — escrow,
 * acknowledgement, streaming, settlement, verification — and each is backed by
 * a different source of evidence (the submit result, an on-chain read, frame
 * arrivals, the terminal frame, the browser-side proof check). This module is
 * the pure reducer that folds those observations into one persistable record;
 * the transport emits it live as a `data-settlement` part and the relay client
 * stores the final version alongside the message, so a reload shows the same
 * completed timeline.
 *
 * Honesty rules baked into the shape:
 *  - `acknowledgedOnChain` distinguishes "the chain read said state ≥ Acked"
 *    from "frames are flowing, so the worker must have picked it up".
 *  - Verification is NOT recorded here at all: it is recomputed at render time
 *    from the persisted proof (see verify-response.ts), so a tampered timeline
 *    cannot mint a green verify node.
 */

export type SettlementStage =
  | "escrowed"
  | "acknowledged"
  | "streaming"
  | "settled"
  | "failed";

export type SettlementProgress = {
  stage: SettlementStage;
  /** ms epoch — when this client learned the job exists on chain. */
  escrowedAtMs?: number;
  /** Worker assigned to the job, read from the chain (never from the relay). */
  worker?: string;
  /** Wei, stringified for JSON. From on-chain Job.escrowedFee. */
  escrowedFeeWei?: string;
  /** Unix seconds — from on-chain Job.deadline. */
  deadlineSec?: number;
  /** ms epoch — first evidence the worker picked the job up. */
  acknowledgedAtMs?: number;
  /**
   * True only when an actual chain read observed state ≥ Acknowledged.
   * Frame flow also implies acknowledgement but is weaker evidence, so the UI
   * labels the two differently.
   */
  acknowledgedOnChain?: boolean;
  /** ms epoch — first payload frame of any kind. */
  firstFrameAtMs?: number;
  /** ms epoch — first answer-text frame (the TTFT moment). */
  firstTextAtMs?: number;
  /** ms epoch — terminal (complete) frame received. */
  settledAtMs?: number;
  /** Unix seconds — on-chain Job.completedAt from a post-settle re-read. */
  settledOnChainSec?: number;
  failedReason?: string;
};

export type SettlementEvent =
  | { type: "escrowed"; atMs: number }
  | {
      type: "chainObserved";
      atMs: number;
      worker: string;
      escrowedFeeWei: string;
      deadlineSec: number;
      /** On-chain Job.state ≥ 1 (Acknowledged) at read time. */
      acknowledged: boolean;
    }
  | { type: "firstFrame"; atMs: number }
  | { type: "firstText"; atMs: number }
  | { type: "settled"; atMs: number }
  | { type: "chainSettled"; completedAtSec: number }
  | { type: "failed"; atMs: number; reason: string };

const STAGE_ORDER: Record<SettlementStage, number> = {
  escrowed: 0,
  acknowledged: 1,
  streaming: 2,
  settled: 3,
  failed: 4,
};

function maxStage(a: SettlementStage, b: SettlementStage): SettlementStage {
  return STAGE_ORDER[b] > STAGE_ORDER[a] ? b : a;
}

/**
 * Folds one observation into the progress record. Events may arrive out of
 * order (the chain read resolving after frames have started is the normal
 * case), so the stage is always recomputed from the evidence present rather
 * than bumped blindly — a late chainObserved can upgrade `acknowledgedOnChain`
 * without regressing a stream that has already started.
 */
export function reduceSettlement(
  prev: SettlementProgress | null,
  event: SettlementEvent
): SettlementProgress {
  const base: SettlementProgress = prev ?? { stage: "escrowed" };
  // Failed is sticky: the stream is closing, nothing after it carries meaning.
  if (base.stage === "failed") return base;

  switch (event.type) {
    case "escrowed":
      return { ...base, escrowedAtMs: event.atMs };

    case "chainObserved": {
      const next: SettlementProgress = {
        ...base,
        worker: event.worker,
        escrowedFeeWei: event.escrowedFeeWei,
        deadlineSec: event.deadlineSec,
      };
      if (event.acknowledged) {
        next.acknowledgedAtMs = base.acknowledgedAtMs ?? event.atMs;
        next.acknowledgedOnChain = true;
        next.stage = maxStage(base.stage, "acknowledged");
      }
      return next;
    }

    case "firstFrame":
      // Frames flowing prove the worker picked the job up, but that is weaker
      // evidence than a chain read, so it never upgrades acknowledgedOnChain.
      return {
        ...base,
        firstFrameAtMs: event.atMs,
        acknowledgedAtMs: base.acknowledgedAtMs ?? event.atMs,
        stage: maxStage(base.stage, "streaming"),
      };

    case "firstText":
      return { ...base, firstTextAtMs: event.atMs };

    case "settled":
      return {
        ...base,
        settledAtMs: event.atMs,
        stage: maxStage(base.stage, "settled"),
      };

    case "chainSettled":
      return { ...base, settledOnChainSec: event.completedAtSec };

    case "failed":
      return { ...base, stage: "failed", failedReason: event.reason };

    default:
      // Unreachable for the tagged union; defensive against a malformed
      // persisted record rather than a real event.
      return base;
  }
}
