/**
 * Silent renewal of the consumer-api token.
 *
 * The token expires an hour after sign-in while the NextAuth session that
 * holds it lasts weeks. Rather than ask for a signature every hour, a token
 * that is about to run out (or already has) is exchanged at
 * POST /api/auth/refresh; consumer-api refuses once the original sign-in is
 * a day old, and that refusal is what finally sends the user back to the
 * wallet.
 */

import { jwtExpirySecs } from "@/lib/jwt";

/** A token with less than this left is exchanged before it is used. */
export const REFRESH_BEFORE_SECS = 15 * 60;

/** The exchange runs inside the session route; it must not hold it long. */
const REFRESH_TIMEOUT_MS = 5000;

/** Whether `token` is within REFRESH_BEFORE_SECS of its exp, or past it. */
export function isRefreshDue(token: string): boolean {
  const exp = jwtExpirySecs(token);
  return exp !== null && exp - Date.now() / 1000 <= REFRESH_BEFORE_SECS;
}

/**
 * Returns a fresh token when `token` is due, null when it still has time or
 * the exchange failed. A failure is not an error to the caller: it keeps the
 * token it has and the sign-in prompt covers whatever happens next.
 */
export async function refreshConsumerToken(
  token: string,
  baseUrl: string
): Promise<string | null> {
  if (!isRefreshDue(token)) {
    return null;
  }
  try {
    const res = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
    });
    if (!res.ok) {
      return null;
    }
    const body = (await res.json()) as { token?: unknown };
    return typeof body.token === "string" ? body.token : null;
  } catch {
    return null;
  }
}
