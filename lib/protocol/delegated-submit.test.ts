import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DelegatedSubmitUnavailableError,
  GatewayClient,
  GatewayClientError,
  InsufficientPrepaidBalanceError,
  walletMayRetry,
} from "./gateway-client";

const auth = {
  buildProtectedHeaders: async () => ({}),
  buildBearerOnlyHeaders: async () => ({}),
};

function submitWithStatus(status: number, body: object = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status }))
  );
  return new GatewayClient("http://api", auth as any).submitMessage(1, "0x01");
}

describe("delegated submit refusals", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([400, 404, 502, 503])(
    "HTTP %i is sent before the broadcast, so the wallet path may retry",
    async (status) => {
      await expect(submitWithStatus(status)).rejects.toBeInstanceOf(
        DelegatedSubmitUnavailableError
      );
    }
  );

  it("HTTP 500 may follow a broadcast, so it stays a hard error", async () => {
    const err = await submitWithStatus(500).catch((e) => e);
    expect(err).toBeInstanceOf(GatewayClientError);
    expect(err).not.toBeInstanceOf(DelegatedSubmitUnavailableError);
  });

  it("HTTP 402 names the fee and what is left when the API reports them", async () => {
    const err = await submitWithStatus(402, {
      error: "allowance_exhausted",
      required: "200000000000000000",
      available: "10000000000000000",
    }).catch((e) => e);
    expect(err).toBeInstanceOf(InsufficientPrepaidBalanceError);
    expect(err.message).toBe(
      "This prompt costs 0.2 LCAI but only 0.01 LCAI of your prepaid balance is available — top up and retry."
    );
  });

  it("HTTP 402 without amounts still tells the user to top up", async () => {
    const err = await submitWithStatus(402, {
      error: "insufficient_balance",
      balance: "0",
    }).catch((e) => e);
    expect(err).toBeInstanceOf(InsufficientPrepaidBalanceError);
    expect(err.message).toBe(
      "Your prepaid balance doesn’t cover this prompt — top up and retry."
    );
  });
});

describe("walletMayRetry", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("a prepaid shortfall is shown to the user, not paid from the wallet", async () => {
    const err = await submitWithStatus(402).catch((e) => e);
    expect(walletMayRetry(err)).toBe(false);
  });

  it("a missing delegate or an unavailable route may retry through the wallet", async () => {
    expect(walletMayRetry(await submitWithStatus(403).catch((e) => e))).toBe(
      true
    );
    expect(walletMayRetry(await submitWithStatus(503).catch((e) => e))).toBe(
      true
    );
    expect(walletMayRetry(await submitWithStatus(500).catch((e) => e))).toBe(
      false
    );
  });
});
