import { afterEach, describe, expect, it, vi } from "vitest";

type Uploader = {
  uploadBlob(data: string, opts: { sessionId: string }): Promise<unknown>;
};

vi.mock("../http", () => ({
  $http: {},
  hasUsableAuthToken: () => true,
}));

vi.mock("./relay-client", () => ({
  RelayClient: class {
    connect() {
      // no-op: the mock socket reports itself connected.
    }
    getStatus() {
      return "connected";
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

// A ready session whose submit starts, as the real one does, by uploading the
// prompt through the transport's gateway.
vi.mock("./session", () => ({
  MaxReassignmentsError: class extends Error {},
  MissingDisputerKeyError: class extends Error {},
  SessionManager: class {
    status = "ready";
    sessionId = 7;
    relayToken = "token";
    private readonly gateway: Uploader;
    constructor(config: { gateway: Uploader }) {
      this.gateway = config.gateway;
    }
    setOnStatusChange() {
      // no-op
    }
    async initialize() {
      // Already ready.
    }
    getRelayUrl() {
      return "wss://relay.test";
    }
    refreshRelayToken() {
      return Promise.resolve("token");
    }
    submitJob() {
      return this.gateway.uploadBlob("AA==", { sessionId: "7" });
    }
  },
}));

const { ProtocolTransport } = await import("./transport");
const { GatewayClient, RateLimitedError } = await import("./gateway-client");

const auth = {
  buildProtectedHeaders: async () => ({}),
  buildBearerOnlyHeaders: async () => ({}),
};

function transportWithRateLimitedUpload() {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            statusCode: 429,
            error: "rate_limited",
            retryAfterSec: 30,
          }),
          { status: 429 }
        )
    )
  );
  return new ProtocolTransport({
    gateway: new GatewayClient("http://api", auth as never),
    publicClient: { chain: { id: 1 } },
  } as never);
}

describe("a rate-limited prompt upload", () => {
  afterEach(() => vi.unstubAllGlobals());

  // Single-model chat (useChat) and each multi-model row read this stream's
  // error chunk and show its text.
  it("ends the chat stream with the rate-limit message", async () => {
    const { response } = await transportWithRateLimitedUpload().sendMessages({
      messages: [
        { id: "m1", role: "user", parts: [{ type: "text", text: "hi" }] },
      ],
      body: { id: "chat-1", groupId: "g1", friendlyModelId: "llama" },
    });

    expect(await response.text()).toContain(
      JSON.stringify({
        type: "error",
        errorText: "Too many requests — wait 30s and retry.",
      })
    );
  });

  // Read-aloud shows a RateLimitedError's message as the toast description.
  it("rejects read-aloud with the rate-limit error", async () => {
    const err = await transportWithRateLimitedUpload()
      .synthesizeSpeech("hello")
      .catch((e) => e);

    expect(err).toBeInstanceOf(RateLimitedError);
    expect(err.message).toBe("Too many requests — wait 30s and retry.");
  });
});
