/**
 * Reconciles one poll's eligible-worker reads for a model with the count last
 * believed.
 *
 * The RPC occasionally answers an empty set for a model that has workers, so
 * a batch that saw nothing but zeros keeps the last positive count rather than
 * blanking the picker. A batch that saw any worker at all is trusted as-is —
 * including when it is lower than before — so a model that lost workers shows
 * the drop instead of its session high-water mark.
 */
export function reconcileWorkerCount(
  observedLengths: readonly number[],
  lastKnownGood: number | undefined
): number | undefined {
  if (observedLengths.length === 0) return lastKnownGood;
  const observed = Math.max(...observedLengths);
  if (observed > 0) return observed;
  return lastKnownGood ?? 0;
}
