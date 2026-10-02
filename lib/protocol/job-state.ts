/**
 * IJobRegistry.JobState enum values, mirrored from the contract:
 *   0=Submitted 1=Acknowledged 2=Completed 3=TimedOut 4=Disputed 5=Resolved
 *   6=Released
 *
 * A keeper advances jobs past Completed once the dispute window closes
 * (Resolved after a dispute, Released after a clean payout), so any check
 * that wants "did this job complete" must accept the post-completion
 * terminal states too — an exact `state === 2` misreads a settled-then-
 * released job as unsettled, which is exactly what a keeper running on a
 * short devnet window surfaces within minutes.
 */

/** States in which the worker's completion (and its commitments) exist. */
export function isCompletedJobState(state: number): boolean {
  return state === 2 || state === 5 || state === 6;
}

/**
 * States in which the fee reached its final owner: Resolved after a dispute,
 * Released after a clean payout. Completed is not one of them — the job is
 * still disputable until the window closes.
 */
export function isSettledJobState(state: number): boolean {
  return state === 5 || state === 6;
}
