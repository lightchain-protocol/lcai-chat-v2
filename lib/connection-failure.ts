/**
 * A request that never reached consumer-api: offline, DNS, a dropped
 * connection, or a proxy error whose response carries no CORS headers (the
 * browser reports that last one as a CORS failure, which is misleading — the
 * request simply did not complete).
 *
 * Worth its own branch because the honest thing to tell someone differs by
 * stage. Session setup spends nothing: the fee is escrowed by
 * submitJobOnBehalf, which only runs after a worker has claimed. So a failure
 * here costs nothing and needs no refund — and saying "a refund is on the
 * way" would be false. A job that WAS submitted and never answered is the
 * other case, and JobTimeoutToast already handles it by offering
 * claimTimeout, which returns the fee.
 */
export function isConnectionFailure(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    // Browsers disagree on the wording: Chrome "Failed to fetch",
    // Safari "Load failed", Firefox "NetworkError when attempting to fetch".
    if (
      current.name === "TypeError" &&
      /failed to fetch|load failed|networkerror/i.test(current.message)
    ) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

