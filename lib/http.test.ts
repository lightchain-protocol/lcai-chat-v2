import { afterEach, describe, expect, it, vi } from "vitest";

// lib/http reaches the server-side NextAuth module, which only loads inside Next.
vi.mock("@/app/(auth)/auth", () => ({ auth: () => Promise.resolve(null) }));

const { clearAuthToken, hasUsableAuthToken, setAuthToken } = await import(
  "./http"
);

function tokenExpiringIn(secs: number): string {
  const payload = { sub: "0xabc", exp: Math.floor(Date.now() / 1000) + secs };
  const b64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `eyJhbGciOiJFUzI1NksifQ.${b64}.sig`;
}

describe("hasUsableAuthToken", () => {
  afterEach(() => clearAuthToken());

  it("accepts a token with time left", () => {
    setAuthToken(tokenExpiringIn(600));
    expect(hasUsableAuthToken()).toBe(true);
  });

  it("rejects a token past its exp", () => {
    setAuthToken(tokenExpiringIn(-60));
    expect(hasUsableAuthToken()).toBe(false);
  });

  it("rejects a token about to expire mid-send", () => {
    setAuthToken(tokenExpiringIn(10));
    expect(hasUsableAuthToken()).toBe(false);
  });

  it("rejects a missing token", () => {
    expect(hasUsableAuthToken()).toBe(false);
  });

  it("leaves an unreadable token for the server to judge", () => {
    setAuthToken("not-a-jwt");
    expect(hasUsableAuthToken()).toBe(true);
  });
});
