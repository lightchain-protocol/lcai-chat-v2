import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DelegatedSubmitUnavailableError,
  GatewayClient,
  GatewayClientError,
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
});
