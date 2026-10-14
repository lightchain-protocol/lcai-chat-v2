import type { LightchainJob } from "@lightchainai/sdk";

const TX_HASH = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const WEI = /^[0-9]+$/;
const RETRY_AFTER = /Retry after (\d+) s/;
const DECLINED = /user rejected|user denied|rejected the request/i;

/** The job a completion ran as, from its `x-lightchain` header; null when it names none. */
export function proofOf(header: string | null): LightchainJob | null {
  try {
    const job = JSON.parse(header ?? "");
    const ok =
      typeof job?.job_id === "string" &&
      typeof job.session_id === "string" &&
      TX_HASH.test(job.tx_hash) &&
      ADDRESS.test(job.worker);
    return ok ? job : null;
  } catch {
    return null;
  }
}

type ErrorBody = {
  error?: {
    message?: unknown;
    code?: unknown;
    accepts?: { scheme?: unknown; amount?: unknown }[];
  };
} | null;

/** What a 402 asks one run to pay, in wei: its prepaid-debit amount. */
export function priceOf(body: unknown): bigint | undefined {
  const accept = (body as ErrorBody)?.error?.accepts?.find(
    (a) => a?.scheme === "prepaid-debit"
  );
  return typeof accept?.amount === "string" && WEI.test(accept.amount)
    ? BigInt(accept.amount)
    : undefined;
}

/** Why a run gave no answer, in words for the visitor; `deposit` when a top-up fixes it. */
export type Failure = { message: string; deposit?: boolean };

/**
 * A /v1 answer that isn't a completion, as a Failure. The visitor never
 * sees raw server text: the error code picks the words, and the message is
 * read only for the SDK's refusal and a limit's wait.
 */
export function responseFailure(status: number, body: unknown): Failure {
  const error = (body as ErrorBody)?.error;
  const code = typeof error?.code === "string" ? error.code : null;
  const text = typeof error?.message === "string" ? error.message : "";

  if (status === 402) {
    // The SDK hands an unpaid 402 back with its reason first.
    if (text.startsWith("Not paid by the SDK") && DECLINED.test(text)) {
      return {
        message:
          "You declined the signature in your wallet, so nothing was paid.",
      };
    }
    if (code === "insufficient_funds") {
      return {
        message:
          "Your prepaid balance doesn't cover this run's fee. Deposit LCAI, then run again.",
        deposit: true,
      };
    }
    if (code === "invalid_prepaid_debit_payload_expired") {
      return {
        message:
          "The signature came more than two minutes after the price was set. Run again and approve it sooner.",
      };
    }
    return {
      message: "The payment wasn't accepted, so nothing was paid. Run again.",
    };
  }
  if (status === 429) {
    if (code === "concurrency_limit_exceeded") {
      return {
        message: "Your previous run is still going. Run again once it's done.",
      };
    }
    // Per payer, per address, or server-wide: none of them is the visitor's doing alone.
    const wait = RETRY_AFTER.exec(text)?.[1];
    return {
      message: `Too many requests right now. ${wait ? `Wait ${wait} s` : "Wait a minute"} and run again.`,
    };
  }
  switch (code) {
    case "model_not_found":
      return {
        message: "No worker serves this model right now. Pick another one.",
      };
    case "no_worker_available":
      return {
        message:
          "No worker took the job in time. Run again, or pick another model.",
      };
    case "job_failed":
      return {
        message: "The worker didn't finish the job. Run again.",
      };
    case "context_length_exceeded":
      return { message: "The prompt is too long for one job. Shorten it." };
    case "blob_fee_too_high":
      return {
        message: "The network is busy right now. Run again in a minute.",
      };
    default:
      return status >= 500
        ? {
            message:
              "The Developer API couldn't finish this run. Run again in a moment.",
          }
        : { message: `The run failed (HTTP ${status}). Run again.` };
  }
}

/** A run's steps: the API names the price, the wallet signs it, the paid job runs. */
export type Step = "price" | "sign" | "run";

/** A run that threw instead of answering at `step`, in words for the visitor. */
export function thrownFailure(error: unknown, step: Step): string {
  const { code, message } = (error ?? {}) as {
    code?: unknown;
    message?: unknown;
  };
  if (
    code === 4001 ||
    (typeof message === "string" && DECLINED.test(message))
  ) {
    return "You declined the request in your wallet, so nothing was paid.";
  }
  if (error instanceof TypeError) {
    // A proxy in front of the API closes a request that waits too long,
    // without CORS headers, so a slow job reads as a failed fetch.
    return step === "run"
      ? "No answer came back in time, and the connection closed. The run was paid when its job started; if the worker never finishes it, the fee is refunded to your prepaid balance when the job times out on chain."
      : "Couldn't reach the Developer API. Check your connection and run again.";
  }
  return "The run failed. Run again.";
}
