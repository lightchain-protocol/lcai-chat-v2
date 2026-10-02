import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isRefreshDue,
  REFRESH_BEFORE_SECS,
  refreshConsumerToken,
} from "./refresh";

const NOW = 1_800_000_000;

function tokenExpiringAt(exp: number): string {
  const b64 = Buffer.from(JSON.stringify({ sub: "0xabc", exp })).toString(
    "base64url"
  );
  return `eyJhbGciOiJFUzI1NksifQ.${b64}.sig`;
}

function stubFetch(status: number, body: unknown) {
  const f = vi.fn(() =>
    Promise.resolve({
      ok: status < 400,
      status,
      json: () => Promise.resolve(body),
    } as Response)
  );
  vi.stubGlobal("fetch", f);
  return f;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW * 1000);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("isRefreshDue", () => {
  it("is false while the token has time left", () => {
    expect(isRefreshDue(tokenExpiringAt(NOW + REFRESH_BEFORE_SECS + 60))).toBe(
      false
    );
  });

  it("is true near and past exp, false for an unreadable token", () => {
    expect(isRefreshDue(tokenExpiringAt(NOW + 60))).toBe(true);
    expect(isRefreshDue(tokenExpiringAt(NOW - 3600))).toBe(true);
    expect(isRefreshDue("junk")).toBe(false);
  });
});

describe("refreshConsumerToken", () => {
  it("leaves a token with time left alone", async () => {
    const f = stubFetch(200, { token: "new" });
    const token = tokenExpiringAt(NOW + REFRESH_BEFORE_SECS + 60);
    expect(await refreshConsumerToken(token, "http://api")).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it("exchanges a token that is about to expire, sending it as the bearer", async () => {
    const f = stubFetch(200, { token: "new" });
    const token = tokenExpiringAt(NOW + 60);
    expect(await refreshConsumerToken(token, "http://api")).toBe("new");
    expect(f).toHaveBeenCalledWith(
      "http://api/api/auth/refresh",
      expect.objectContaining({
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      })
    );
  });

  it("exchanges a token that has already expired", async () => {
    stubFetch(200, { token: "new" });
    expect(
      await refreshConsumerToken(tokenExpiringAt(NOW - 3600), "http://api")
    ).toBe("new");
  });

  it("returns null when consumer-api refuses", async () => {
    stubFetch(401, { error: "session_expired" });
    expect(
      await refreshConsumerToken(tokenExpiringAt(NOW - 1), "http://api")
    ).toBeNull();
  });

  it("returns null when the network fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("ECONNREFUSED")))
    );
    expect(
      await refreshConsumerToken(tokenExpiringAt(NOW - 1), "http://api")
    ).toBeNull();
  });
});
