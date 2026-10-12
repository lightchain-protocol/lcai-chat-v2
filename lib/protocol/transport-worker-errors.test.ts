import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../http", () => ({
  $http: {},
  hasUsableAuthToken: () => true,
}));

// True when a session opens through the delegate, false when opening one is a
// wallet transaction.
let sortition = true;
vi.mock("@/config", () => ({
  get isSortitionEnabled() {
    return sortition;
  },
}));

const noop = () => {
  // no-op: nothing in these tests depends on it.
};

type Frame = Record<string, unknown>;

// One entry per send: the session the prompt went out on, and the callback the
// relay delivers that prompt's frames to.
const sends: Array<{ sessionId: number; onFrame: (frame: Frame) => void }> = [];

vi.mock("./relay-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./relay-client")>()),
  RelayClient: class {
    connect = noop;
    disconnect = noop;
    onLifecycle = noop;
    onReconnect = noop;
    beginAssistantMessage = noop;
    replaceAssistantText = noop;
    setAssistantProof = noop;
    setAssistantSettlement = noop;
    setAssistantMetrics = noop;
    discardAssistantMessage = noop;
    getStatus() {
      return "connected";
    }
    hasUnboundPendingJob() {
      return false;
    }
    onPendingJob(sessionId: number, onFrame: (frame: Frame) => void) {
      sends.push({ sessionId, onFrame });
      return noop;
    }
    completeAssistantMessage() {
      return Promise.resolve();
    }
  },
}));

let sessionsOpened = 0;
let resets = 0;

// Opens a session only when it holds none, like the real manager, and numbers
// them in the order they were opened.
vi.mock("./session", () => ({
  MaxReassignmentsError: class extends Error {},
  MissingDisputerKeyError: class extends Error {},
  SessionManager: class {
    status = "idle";
    sessionId: number | null = null;
    relayToken = "token";
    setOnStatusChange = noop;
    initialize() {
      if (this.status !== "ready") {
        sessionsOpened += 1;
        this.sessionId = sessionsOpened;
        this.status = "ready";
      }
      return Promise.resolve();
    }
    release() {
      this.status = "idle";
      this.sessionId = null;
    }
    reset() {
      resets += 1;
      this.release();
    }
    getRelayUrl() {
      return "wss://relay.test";
    }
    refreshRelayToken() {
      return Promise.resolve("token");
    }
    submitJob() {
      return new Promise(() => {
        // never settles: the first frame is what binds the job here.
      });
    }
    decryptResponse() {
      return Promise.resolve("An answer.");
    }
    getJob() {
      return Promise.reject(new Error("no chain in this test"));
    }
  },
}));

const { ProtocolTransport } = await import("./transport");
type Transport = InstanceType<typeof ProtocolTransport>;

function makeTransport() {
  return new ProtocolTransport({
    gateway: {},
    publicClient: { chain: { id: 1 } },
  } as never);
}

// What a worker publishes when it gives up on a job: no code and no message.
const workerError: Frame = { type: "error" };
const answer: Frame = { type: "complete", seq: 1, payload: "QW4gYW5zd2VyLg==" };
const emptyAnswer: Frame = { type: "complete", seq: 1, payload: "" };
// The relay's own error frame; droppedSeq 0 is the one that ends a turn.
const relayRateLimit: Frame = {
  type: "error",
  code: "RATE_LIMITED",
  droppedSeq: 0,
  message: "rate limit exceeded",
};

const NEW_SESSION_NOTICE = "the model will no longer see the earlier messages";

let lastJobId = 0;

/** Delivers a frame for the latest send's job; returns that send's session. */
function deliver(frame: Frame): number {
  const send = sends.at(-1);
  if (!send) throw new Error("the send never subscribed to the relay");
  send.onFrame({ jobId: lastJobId, sessionId: send.sessionId, ...frame });
  return send.sessionId;
}

/**
 * Sends one message and ends the turn with `frame`. Resolves with the session
 * the prompt went out on and the stream the chat reads its error text from.
 */
async function turn(
  t: Transport,
  frame: Frame,
  beforeFrame: () => void = noop
) {
  const { response } = await t.sendMessages({
    messages: [
      { id: "m1", role: "user", parts: [{ type: "text", text: "hi" }] },
    ],
    // A regenerate skips the user-message persist, which is not under test.
    body: { id: "chat-1", trigger: "regenerate-message" },
  });
  lastJobId += 1;
  beforeFrame();
  const sessionId = deliver(frame);
  return { sessionId, shown: await response.text() };
}

describe("worker errors in a row on one session", () => {
  afterEach(() => {
    sortition = true;
    sends.length = 0;
    sessionsOpened = 0;
    resets = 0;
    lastJobId = 0;
  });

  it("keeps the session after a single failed turn", async () => {
    const t = makeTransport();

    const failed = await turn(t, workerError);
    const next = await turn(t, answer);

    expect(failed.shown).toContain("The worker reported an error");
    expect(failed.shown).not.toContain(NEW_SESSION_NOTICE);
    expect(next.sessionId).toBe(failed.sessionId);
    expect(resets).toBe(0);
  });

  it("sends the message after two failed turns in a new session, and says so", async () => {
    const t = makeTransport();

    const first = await turn(t, workerError);
    const second = await turn(t, workerError);
    const next = await turn(t, answer);

    expect(second.sessionId).toBe(first.sessionId);
    expect(second.shown).toContain(NEW_SESSION_NOTICE);
    expect(resets).toBe(1);
    expect(next.sessionId).not.toBe(first.sessionId);
    expect(next.shown).toContain("An answer.");
  });

  it("starts the count again after an answered turn", async () => {
    const t = makeTransport();

    const first = await turn(t, workerError);
    await turn(t, answer);
    const third = await turn(t, workerError);
    const next = await turn(t, answer);

    expect(third.shown).not.toContain(NEW_SESSION_NOTICE);
    expect(next.sessionId).toBe(first.sessionId);
    expect(resets).toBe(0);
  });

  it.each([
    ["an empty answer", emptyAnswer],
    ["the relay's rate-limit frame", relayRateLimit],
  ])("neither counts nor clears a turn ended by %s", async (_name, other) => {
    const t = makeTransport();

    const first = await turn(t, workerError);
    const otherTurn = await turn(t, other);
    // Still the first session, and the earlier worker error still stands.
    const third = await turn(t, workerError);

    expect(otherTurn.shown).not.toContain(NEW_SESSION_NOTICE);
    expect(third.sessionId).toBe(first.sessionId);
    expect(third.shown).toContain(NEW_SESSION_NOTICE);
  });

  it("does not count an error frame that arrives after the turn has ended", async () => {
    const t = makeTransport();

    // The job is answered, and a stray error frame for it is queued behind.
    await turn(t, workerError, () => deliver(answer));
    const second = await turn(t, workerError);

    expect(second.shown).not.toContain(NEW_SESSION_NOTICE);
    expect(resets).toBe(0);
  });

  it("starts the count again when the session changes for another reason", async () => {
    const t = makeTransport();

    await turn(t, workerError);
    t.startNewSession();
    const second = await turn(t, workerError);
    const next = await turn(t, answer);

    expect(second.shown).not.toContain(NEW_SESSION_NOTICE);
    expect(next.sessionId).toBe(second.sessionId);
    // Only the explicit action above reset anything.
    expect(resets).toBe(1);
  });

  it("offers the switch instead of making it where a new session needs a wallet signature", async () => {
    sortition = false;
    const t = makeTransport();
    const failover: string[] = [];
    t.setOnFailoverStatus((status) => failover.push(status));

    const first = await turn(t, workerError);
    const second = await turn(t, workerError);
    const next = await turn(t, answer);

    // "rollover_required" is what puts the banner with its New Session button up.
    expect(failover).toEqual(["rollover_required"]);
    expect(second.shown).not.toContain(NEW_SESSION_NOTICE);
    expect(resets).toBe(0);
    expect(next.sessionId).toBe(first.sessionId);
  });

  it("leaves the session alone once the chat has let go of the transport", async () => {
    const t = makeTransport();

    await turn(t, workerError);
    // The user left the chat while the second answer was still on its way.
    const second = await turn(t, workerError, () => t.release());

    expect(second.shown).not.toContain(NEW_SESSION_NOTICE);
    expect(resets).toBe(0);
  });
});
