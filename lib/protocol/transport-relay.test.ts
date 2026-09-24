import { describe, expect, it, vi } from "vitest";

let signedIn = true;

vi.mock("../http", () => ({
  $http: {},
  hasUsableAuthToken: () => signedIn,
}));

const calls: string[] = [];

vi.mock("./relay-client", () => ({
  RelayClient: class {
    private status = "disconnected";
    constructor(_url: string, token: string) {
      calls.push(`relay:${token}`);
    }
    connect() {
      this.status = "connecting";
      setTimeout(() => {
        this.status = "connected";
        calls.push("connected");
      }, 0);
    }
    getStatus() {
      return this.status;
    }
    disconnect() {
      // no-op: a mock socket has nothing to close.
    }
    onLifecycle() {
      // no-op
    }
    onReconnect() {
      // no-op
    }
    hasUnboundPendingJob() {
      return false;
    }
    onPendingJob() {
      return () => {
        // no-op unsubscribe
      };
    }
  },
}));

vi.mock("./session", () => ({
  MaxReassignmentsError: class extends Error {},
  MissingDisputerKeyError: class extends Error {},
  SessionManager: class {
    status = "ready";
    sessionId = 3105;
    relayToken = "expired";
    setOnStatusChange() {
      // no-op
    }
    async initialize() {
      // Already ready: a session restored or reused past its token's life.
    }
    getRelayUrl() {
      return "wss://relay.test";
    }
    refreshRelayToken() {
      calls.push("refresh");
      this.relayToken = "fresh";
      return Promise.resolve("fresh");
    }
    submitJob() {
      calls.push("submit");
      return new Promise(() => {
        // never settles: only the ordering before submit matters here.
      });
    }
  },
}));

const { ProtocolTransport } = await import("./transport");
const { ProtocolAuthExpiredError } = await import("./gateway-client");

describe("ProtocolTransport.sendMessages relay", () => {
  it("re-mints the token and waits for a live socket before submitting", async () => {
    const t = new ProtocolTransport({
      gateway: {},
      publicClient: { chain: { id: 1 } },
    } as never);
    // The socket from an hour ago has dropped; its token has expired.
    (t as unknown as { relayClient: unknown }).relayClient = {
      getStatus: () => "disconnected",
      disconnect: () => {
        calls.push("old-disconnected");
      },
    };

    await t
      .sendMessages({
        messages: [
          { id: "m1", role: "user", parts: [{ type: "text", text: "hi" }] },
        ],
        body: { id: "chat-1", trigger: "regenerate-message" },
      })
      .catch(() => {
        // Later persistence steps are not mocked; the ordering is the point.
      });

    const submitAt = calls.indexOf("submit");
    expect(calls.indexOf("refresh")).toBeGreaterThanOrEqual(0);
    expect(calls).toContain("relay:fresh");
    expect(calls).not.toContain("relay:expired");
    expect(calls.indexOf("connected")).toBeLessThan(submitAt);
    expect(calls.indexOf("refresh")).toBeLessThan(submitAt);
  });

  it("refuses before anything is sent once the sign-in has expired", async () => {
    signedIn = false;
    calls.length = 0;
    const t = new ProtocolTransport({
      gateway: {},
      publicClient: { chain: { id: 1 } },
    } as never);

    await expect(
      t.sendMessages({
        messages: [
          { id: "m1", role: "user", parts: [{ type: "text", text: "hi" }] },
        ],
        body: { id: "chat-1" },
      })
    ).rejects.toBeInstanceOf(ProtocolAuthExpiredError);
    expect(calls).toEqual([]);
    signedIn = true;
  });
});
