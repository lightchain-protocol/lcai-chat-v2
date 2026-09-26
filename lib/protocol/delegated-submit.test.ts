import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DelegatedSubmitUnavailableError,
  DelegateNotAuthorizedError,
  GatewayClient,
  GatewayClientError,
  InsufficientPrepaidBalanceError,
  walletMayRetry,
} from "./gateway-client";

const auth = {
  buildProtectedHeaders: async () => ({}),
  buildBearerOnlyHeaders: async () => ({}),
};

function submitWithStatus(status: number) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status }))
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

  it("HTTP 402 is a prepaid shortfall the user must see, not a wallet retry", async () => {
    const err = await submitWithStatus(402).catch((e) => e);
    expect(err).toBeInstanceOf(InsufficientPrepaidBalanceError);
    expect(walletMayRetry(err)).toBe(false);
  });

  it("a missing delegate or an unavailable route may retry through the wallet", () => {
    expect(walletMayRetry(new DelegateNotAuthorizedError("0x01"))).toBe(true);
    expect(walletMayRetry(new DelegatedSubmitUnavailableError(503))).toBe(true);
  });
});
