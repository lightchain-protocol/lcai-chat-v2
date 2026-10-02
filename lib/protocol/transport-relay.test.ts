import { afterEach, describe, expect, it, vi } from "vitest";

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

function relayTokenExpiringIn(secs: number): string {
  const payload = { exp: Math.floor(Date.now() / 1000) + secs };
  const b64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `eyJhbGciOiJFUzI1NksifQ.${b64}.sig`;
}

function makeTransport() {
  return new ProtocolTransport({
    gateway: {},
    publicClient: { chain: { id: 1 } },
  } as never);
}

function sendHi(t: InstanceType<typeof ProtocolTransport>) {
  return t
    .sendMessages({
      messages: [
        { id: "m1", role: "user", parts: [{ type: "text", text: "hi" }] },
      ],
      body: { id: "chat-1", trigger: "regenerate-message" },
    })
    .catch(() => {
      // Later persistence steps are not mocked; the ordering is the point.
    });
}

describe("ProtocolTransport.sendMessages relay", () => {
  afterEach(() => {
    signedIn = true;
    calls.length = 0;
  });

  it("re-mints the token and waits for a live socket before submitting", async () => {
    const t = makeTransport();
    // The socket from an hour ago has dropped; its token has expired.
    (t as unknown as { relayClient: unknown }).relayClient = {
      getStatus: () => "disconnected",
      disconnect: () => {
        calls.push("old-disconnected");
      },
    };

    await sendHi(t);

    const submitAt = calls.indexOf("submit");
    expect(calls.indexOf("refresh")).toBeGreaterThanOrEqual(0);
    expect(calls).toContain("relay:fresh");
    expect(calls).not.toContain("relay:expired");
    expect(calls.indexOf("connected")).toBeLessThan(submitAt);
    expect(calls.indexOf("refresh")).toBeLessThan(submitAt);
  });

  it("keeps a held relay token that still has time left", async () => {
    const t = makeTransport();
    const live = relayTokenExpiringIn(3000);
    (
      t as unknown as { sessionMgr: { relayToken: string } }
    ).sessionMgr.relayToken = live;

    await sendHi(t);

    expect(calls).not.toContain("refresh");
    expect(calls).toContain(`relay:${live}`);
    expect(calls.indexOf("connected")).toBeLessThan(calls.indexOf("submit"));
  });

  it("re-mints a held relay token that is about to run out", async () => {
    const t = makeTransport();
    (
      t as unknown as { sessionMgr: { relayToken: string } }
    ).sessionMgr.relayToken = relayTokenExpiringIn(60);

    await sendHi(t);

    expect(calls.indexOf("refresh")).toBeLessThan(calls.indexOf("submit"));
    expect(calls).toContain("relay:fresh");
  });

  it("refuses before anything is sent once the sign-in has expired", async () => {
    signedIn = false;
    const t = makeTransport();

    await expect(
      t.sendMessages({
        messages: [
          { id: "m1", role: "user", parts: [{ type: "text", text: "hi" }] },
        ],
        body: { id: "chat-1" },
      })
    ).rejects.toBeInstanceOf(ProtocolAuthExpiredError);
    expect(calls).toEqual([]);
  });
});
