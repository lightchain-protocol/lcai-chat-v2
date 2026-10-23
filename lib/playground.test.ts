import { describe, expect, it } from "vitest";
import { priceOf, proofOf, responseFailure, thrownFailure } from "./playground";

const job = {
  job_id: "1601",
  session_id: "940",
  tx_hash: `0x${"ab".repeat(32)}`,
  worker: "0x8fB2d8C5a2bA4C1f0e7b5f3c2d1e0f9a8b7c6d5e",
};

/** A /v1 error body, as the API and the SDK send it. */
const openAIError = (code: string | null, message = "raw server text") => ({
  error: { message, type: "x", code },
});

describe("proofOf", () => {
  it("reads the job from the x-lightchain header", () => {
    expect(proofOf(JSON.stringify(job))).toEqual(job);
  });

  it("is null for a missing, unreadable or incomplete header", () => {
    expect(proofOf(null)).toBeNull();
    expect(proofOf("not json")).toBeNull();
    expect(proofOf(JSON.stringify({ ...job, tx_hash: "0x12" }))).toBeNull();
    expect(proofOf(JSON.stringify({ ...job, worker: undefined }))).toBeNull();
  });
});

describe("priceOf", () => {
  it("is the prepaid-debit amount a 402 asks for", () => {
    const body = {
      error: {
        accepts: [
          { scheme: "delegate" },
          { scheme: "prepaid-debit", amount: "20000000000000000" },
        ],
      },
    };

    expect(priceOf(body)).toBe(20_000_000_000_000_000n);
  });

  it("is undefined when the 402 names no amount", () => {
    expect(priceOf(null)).toBeUndefined();
    expect(priceOf({ error: { accepts: [{ scheme: "delegate" }] } })).toBe(
      undefined
    );
    expect(
      priceOf({
        error: { accepts: [{ scheme: "prepaid-debit", amount: "x" }] },
      })
    ).toBeUndefined();
  });
});

describe("responseFailure", () => {
  it("says a declined signature paid nothing", () => {
    const body = openAIError(
      "payment_required",
      "Not paid by the SDK: User rejected the request. Details: MetaMask Tx Signature: User denied message signature. A call with no API key…"
    );

    expect(responseFailure(402, body).message).toBe(
      "You declined the signature in your wallet, so nothing was paid."
    );
  });

  it("offers a deposit when the balance can't cover the fee", () => {
    const failure = responseFailure(402, openAIError("insufficient_funds"));

    expect(failure.deposit).toBe(true);
    expect(failure.message).toContain("prepaid balance");
  });

  it("explains a signature approved too late", () => {
    expect(
      responseFailure(402, openAIError("invalid_prepaid_debit_payload_expired"))
        .message
    ).toContain("two minutes");
  });

  it("gives the wait a rate limit names", () => {
    const body = openAIError(
      "rate_limit_exceeded",
      "This payer is limited to 30 requests per minute. Retry after 12 s."
    );

    expect(responseFailure(429, body).message).toBe(
      "Too many requests right now. Wait 12 s and run again."
    );
  });

  it("says a run still in flight blocks the next one", () => {
    expect(
      responseFailure(429, openAIError("concurrency_limit_exceeded")).message
    ).toContain("previous run");
  });

  it("names a worker timeout", () => {
    expect(responseFailure(502, openAIError("job_failed")).message).toContain(
      "worker"
    );
    expect(
      responseFailure(503, openAIError("no_worker_available")).message
    ).toContain("worker");
  });

  it("never shows the server's own text", () => {
    const codes = [
      [402, "invalid_prepaid_debit_payload_nonce_used"],
      [404, "model_not_found"],
      [400, "context_length_exceeded"],
      [503, "blob_fee_too_high"],
      [502, "settle_failed"],
      [500, null],
      [418, null],
    ] as const;

    for (const [status, code] of codes) {
      const { message } = responseFailure(status, openAIError(code));
      expect(message).not.toContain("raw server text");
      expect(message.length).toBeGreaterThan(0);
    }
    expect(responseFailure(502, null).message.length).toBeGreaterThan(0);
  });
});

describe("thrownFailure", () => {
  it("says a declined wallet request paid nothing", () => {
    const error = Object.assign(new Error("User rejected the request."), {
      code: 4001,
    });

    expect(thrownFailure(error, "price")).toContain("declined");
  });

  it("says the API couldn't be reached on a network error before paying", () => {
    expect(thrownFailure(new TypeError("Failed to fetch"), "price")).toContain(
      "reach the Developer API"
    );
  });

  it("says a connection lost while the paid job ran was a timeout, and the refund", () => {
    const message = thrownFailure(new TypeError("Failed to fetch"), "run");

    expect(message).toContain("in time");
    expect(message).toContain("refunded");
  });

  it("never shows the error's own text", () => {
    expect(
      thrownFailure(new Error("0xdeadbeef internal"), "sign")
    ).not.toContain("0xdeadbeef");
  });
});
