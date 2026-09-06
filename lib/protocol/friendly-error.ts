import { GatewayClientError } from "./gateway-client";

/**
 * Turns a raw protocol/transport error into one calm sentence a user can act
 * on. The session bootstrap surfaces server codes like `no_worker_available`
 * (HTTP 408) — technically accurate, but "Gateway API error: 408" is not
 * something anyone should read. Map the ones we understand to plain guidance
 * and fall back to a neutral line for the rest; never leak a raw status string.
 */
export function friendlyProtocolError(
  err: unknown,
  modelName?: string
): string {
  const subject = modelName ? `“${modelName}”` : "This model";

  if (err instanceof GatewayClientError) {
    let code = "";
    try {
      code = (JSON.parse(err.body || "{}") as { error?: string }).error ?? "";
    } catch {
      code = "";
    }

    if (err.status === 408 || code === "no_worker_available") {
      return `${subject} has no worker online right now — pick another model or try again in a moment.`;
    }
    if (err.status === 503 || code === "session_request_busy") {
      return "The network is busy right now — please try again in a moment.";
    }
    if (err.status === 402) {
      return "That request needs a small testnet fee that couldn’t be reserved — check your balance and retry.";
    }
    if (err.status === 403 || code === "delegate_not_authorized") {
      return "Your wallet isn’t authorized to start a session yet — reconnect it and try again.";
    }
    if (
      err.status === 409 ||
      code === "request_not_ready" ||
      code === "sortition_disabled"
    ) {
      return "Sessions are momentarily unavailable — please try again shortly.";
    }
    return `${subject} couldn’t be started right now — please try again.`;
  }

  if (err instanceof Error && err.message) {
    return err.message;
  }
  return "Something went wrong — please try again.";
}
