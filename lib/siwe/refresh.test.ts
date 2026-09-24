import { describe, expect, it, vi } from "vitest";
import { REFRESH_BEFORE_SECS, refreshConsumerToken } from "./refresh";

const NOW = 1_800_000_000;

function tokenExpiringAt(exp: number): string {
  const b64 = Buffer.from(JSON.stringify({ sub: "0xabc", exp })).toString(
    "base64url"
  );
  return `eyJhbGciOiJFUzI1NksifQ.${b64}.sig`;
}

function fetchReplying(status: number, body: unknown) {
  return vi.fn(() =>
    Promise.resolve({
      ok: status < 400,
      status,
      json: () => Promise.resolve(body),
    } as Response)
  );
}

describe("refreshConsumerToken", () => {
  it("leaves a token with time left alone", async () => {
    const f = fetchReplying(200, { token: "new" });
    const token = tokenExpiringAt(NOW + REFRESH_BEFORE_SECS + 60);
    expect(
      await refreshConsumerToken(token, "http://api", {
        fetch: f,
        nowSecs: NOW,
      })
    ).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it("exchanges a token that is about to expire, sending it as the bearer", async () => {
    const f = fetchReplying(200, { token: "new" });
    const token = tokenExpiringAt(NOW + 60);
    expect(
      await refreshConsumerToken(token, "http://api", {
        fetch: f,
        nowSecs: NOW,
      })
    ).toBe("new");
    expect(f).toHaveBeenCalledWith("http://api/api/auth/refresh", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
  });

  it("exchanges a token that has already expired", async () => {
    const f = fetchReplying(200, { token: "new" });
    const token = tokenExpiringAt(NOW - 3600);
    expect(
      await refreshConsumerToken(token, "http://api", {
        fetch: f,
        nowSecs: NOW,
      })
    ).toBe("new");
  });

  it("returns null when consumer-api refuses", async () => {
    const f = fetchReplying(401, { error: "session_expired" });
    expect(
      await refreshConsumerToken(tokenExpiringAt(NOW - 1), "http://api", {
        fetch: f,
        nowSecs: NOW,
      })
    ).toBeNull();
  });

  it("returns null when the network fails", async () => {
    const f = vi.fn(() => Promise.reject(new Error("ECONNREFUSED")));
    expect(
      await refreshConsumerToken(tokenExpiringAt(NOW - 1), "http://api", {
        fetch: f as unknown as typeof fetch,
        nowSecs: NOW,
      })
    ).toBeNull();
  });

  it("returns null for a token it cannot read", async () => {
    const f = fetchReplying(200, { token: "new" });
    expect(
      await refreshConsumerToken("junk", "http://api", {
        fetch: f,
        nowSecs: NOW,
      })
    ).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });
});
