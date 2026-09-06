import {
  isCompletedJobState,
  isSettledJobState,
} from "@/lib/protocol/job-state";
import type { TrackedJob } from "@/lib/protocol/transport";

/**
 * The pure step builder behind the on-chain pipeline timeline.
 *
 * Kept out of the component so it can be tested in node: it imports only a
 * TYPE from the transport, so nothing here pulls the transport (and its
 * browser-only dependencies) into a test run.
 */

const ZERO_HASH =
  "0x0000000000000000000000000000000000000000000000000000000000000000";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export type StepState = "pending" | "active" | "done" | "failed";

export type PipelineStep = {
  key: string;
  label: string;
  state: StepState;
  txHash?: string;
  address?: string;
  note?: string;
};

export type Evidence = {
  session?: { sessionId: number; worker: string; txHash: string };
  job?: { jobId: number; txHash: string };
  /** getJob() observed state ≥ Acknowledged (or ackTimestamp > 0). */
  acknowledged?: boolean;
  /** getJob() responseBlobHash committed (non-zero). */
  responseCommitted?: boolean;
  completed?: { txHash: string };
  /** getJob() state. Settled once it reads Resolved (5) or Released (6). */
  jobState?: number;
};

export function isZeroHash(v?: string): boolean {
  return !v || v.toLowerCase() === ZERO_HASH;
}

export function isZeroAddress(v?: string): boolean {
  return !v || v.toLowerCase() === ZERO_ADDRESS;
}

// Text shown under the one active step, so the wait always says what it is
// waiting for rather than sitting silent.
export const ACTIVE_NOTES: Record<string, string> = {
  worker: "finding a worker",
  session: "opening the session",
  submitted: "submitting the job",
  acknowledged: "waiting for the worker",
  generating: "model is generating",
  committed: "committing the response",
  completed: "finalizing on chain",
};

// biome-ignore lint/nursery/useMaxParams: five flat inputs read clearer here than an options bag for a pure builder.
export function buildSteps(
  job: TrackedJob | undefined,
  ev: Evidence,
  firstTokenSeen: boolean,
  isError: boolean,
  activeAllowed: boolean
): { steps: PipelineStep[]; completed: boolean } {
  const worker = isZeroAddress(ev.session?.worker)
    ? isZeroAddress(job?.worker)
      ? undefined
      : job?.worker
    : ev.session?.worker;
  const sessionId = ev.session?.sessionId ?? job?.sessionId;
  const jobId = ev.job?.jobId ?? job?.jobId;
  const sessionTx = ev.session?.txHash;
  const jobTx = ev.job?.txHash;
  const completionTx = ev.completed?.txHash;

  const hasSession = ev.session !== undefined || job !== undefined;
  const hasJob = ev.job !== undefined || job?.jobId !== undefined;
  const acknowledged = ev.acknowledged === true;
  // Completed is chain evidence: the JobCompleted log or a getJob read. The
  // relay reports completion seconds before completeJob lands, and the job's
  // local completedAt carries that relay stamp, so it must not turn this on.
  const completed =
    ev.completed !== undefined ||
    (ev.jobState !== undefined && isCompletedJobState(ev.jobState));
  const committed = ev.responseCommitted === true || completed;
  const settled = ev.jobState !== undefined && isSettledJobState(ev.jobState);

  const defs: Omit<PipelineStep, "state">[] = [
    { key: "requested", label: "Requested", note: "prompt request sent" },
    {
      key: "worker",
      label: "Worker selected",
      address: worker,
      txHash: sessionTx,
    },
    {
      key: "session",
      label: "Session ready",
      txHash: sessionTx,
      note: sessionId !== undefined ? `session #${sessionId}` : undefined,
    },
    {
      key: "submitted",
      label: "Job submitted",
      txHash: jobTx,
      note: jobId !== undefined ? `job #${jobId}` : undefined,
    },
    {
      key: "acknowledged",
      label: "Acknowledged",
      note: acknowledged ? "worker picked up the job" : undefined,
    },
    {
      key: "generating",
      label: "Generating",
      note: firstTokenSeen ? "answer streaming" : undefined,
    },
    {
      key: "committed",
      label: "Response committed",
      txHash: completionTx,
      note: committed ? "blob hash on chain" : undefined,
    },
    {
      key: "completed",
      label: "Completed",
      txHash: completionTx,
      note: completed ? "completion committed on chain" : undefined,
    },
    {
      key: "settled",
      label: "Settled",
      note: settled
        ? "fee finalized on chain"
        : completed
          ? "awaiting the dispute window"
          : undefined,
    },
  ];

  // Strict, evidence-only completion — no step turns green from how far the
  // loading label has advanced.
  const done: boolean[] = [
    true, // requested: the send happened (component only renders once in flight)
    !!worker,
    hasSession,
    hasJob,
    acknowledged,
    firstTokenSeen,
    committed,
    completed,
    settled,
  ];

  // A genuinely-observed later milestone proves the earlier ones (completed ⇒
  // committed ⇒ generated ⇒ …), so backfill in case an in-between read lagged.
  // Safe now that every flag is real evidence, never a label threshold.
  const lastDone = done.lastIndexOf(true);
  for (let i = 0; i < lastDone; i++) done[i] = true;

  let frontierAssigned = false;
  const steps: PipelineStep[] = defs.map((d, i) => {
    let state: StepState;
    if (done[i]) {
      state = "done";
    } else if (frontierAssigned) {
      state = "pending";
    } else {
      frontierAssigned = true;
      state = isError ? "failed" : activeAllowed ? "active" : "pending";
    }
    // The active step always narrates what it is waiting for.
    const note = state === "active" && !d.note ? ACTIVE_NOTES[d.key] : d.note;
    return { ...d, note, state };
  });

  return { steps, completed };
}
