import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GenerationStats, WSErrorFrame, WSFrame } from "./relay-client";
import {
  PendingJobConflictError,
  parseGenerationStats,
  RelayClient,
  TOMBSTONE_DRAIN_TTL_MS,
} from "./relay-client";

// relay-client pulls in $http for assistant-message persistence, which drags
// the next-auth server config into a node test run. None of it is exercised
// here, so it is stubbed at the module boundary.
vi.mock("../http", () => ({
  $http: { post: vi.fn() },
}));

type SocketMessage = { data: unknown };

class FakeWebSocket {
  static readonly OPEN = 1;
  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.OPEN;
  onopen: (() => void) | null = null;
  onmessage: ((event: SocketMessage) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  readonly url: string;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  close() {
    this.closed = true;
  }
}

const SESSION_ID = 7;

const originalWebSocket = globalThis.WebSocket;

beforeEach(() => {
  FakeWebSocket.instances = [];
  (globalThis as { WebSocket: unknown }).WebSocket = FakeWebSocket;
});

afterEach(() => {
  (globalThis as { WebSocket: unknown }).WebSocket = originalWebSocket;
  vi.restoreAllMocks();
});

function connectClient() {
  const client = new RelayClient("ws://relay.test/ws", "jwt-token");
  client.connect();
  const socket = FakeWebSocket.instances.at(-1);
  if (!socket) throw new Error("RelayClient did not open a socket");
  return { client, socket };
}

function chunkFrame(overrides: Partial<WSFrame> = {}): WSFrame {
  return {
    type: "chunk",
    jobId: 100,
    sessionId: SESSION_ID,
    seq: 1,
    totalChunks: 1,
    payload: "cGF5bG9hZA==",
    signature: "sig",
    correlationId: "corr-1",
    ts: 1_700_000_000,
    ...overrides,
  };
}

function deliver(socket: FakeWebSocket, frame: unknown) {
  socket.onmessage?.({ data: JSON.stringify(frame) });
}

/** Error frames carry no seq, so tests read it through a narrowing helper. */
function seqOf(frame: WSFrame | WSErrorFrame): number {
  return "seq" in frame ? frame.seq : -1;
}

describe("RelayClient.onPendingJob", () => {
  it("binds to the first frame of its session and receives it", () => {
    const { client, socket } = connectClient();
    const received: Array<WSFrame | WSErrorFrame> = [];

    client.onPendingJob(SESSION_ID, (frame) => received.push(frame));
    deliver(socket, chunkFrame({ jobId: 412 }));

    expect(received).toHaveLength(1);
    expect(received[0].jobId).toBe(412);
  });

  it("routes later frames of the bound job through the normal job path", () => {
    const { client, socket } = connectClient();
    const received: Array<WSFrame | WSErrorFrame> = [];

    client.onPendingJob(SESSION_ID, (frame) => received.push(frame));
    deliver(socket, chunkFrame({ jobId: 412, seq: 1 }));
    // The handler is no longer pending, so these can only arrive via jobCallbacks.
    expect(client.hasUnboundPendingJob(SESSION_ID)).toBe(false);
    deliver(socket, chunkFrame({ jobId: 412, seq: 2 }));
    deliver(socket, chunkFrame({ jobId: 412, seq: 3, type: "complete" }));

    expect(received.map(seqOf)).toEqual([1, 2, 3]);
  });

  it("ignores frames from a different session", () => {
    const { client, socket } = connectClient();
    const received: Array<WSFrame | WSErrorFrame> = [];

    client.onPendingJob(SESSION_ID, (frame) => received.push(frame));
    deliver(socket, chunkFrame({ jobId: 900, sessionId: SESSION_ID + 1 }));

    expect(received).toHaveLength(0);
    expect(client.hasUnboundPendingJob(SESSION_ID)).toBe(true);
  });

  it("refuses a second unbound handler for the same session", () => {
    const { client } = connectClient();

    client.onPendingJob(SESSION_ID, () => {
      // first, still unbound
    });

    expect(() =>
      client.onPendingJob(SESSION_ID, () => {
        // second registration must not silently displace the first
      })
    ).toThrow(PendingJobConflictError);
    expect(client.hasUnboundPendingJob(SESSION_ID)).toBe(true);
  });

  it("allows a new handler once the incumbent has bound, without stealing its frames", () => {
    const { client, socket } = connectClient();
    const first: number[] = [];
    const second: number[] = [];

    client.onPendingJob(SESSION_ID, (frame) => first.push(frame.jobId));
    deliver(socket, chunkFrame({ jobId: 500 }));

    // Second prompt registered while the first job is still streaming.
    client.onPendingJob(SESSION_ID, (frame) => second.push(frame.jobId));
    deliver(socket, chunkFrame({ jobId: 500, seq: 2 }));
    deliver(socket, chunkFrame({ jobId: 501 }));
    deliver(socket, chunkFrame({ jobId: 501, seq: 2 }));

    expect(first).toEqual([500, 500]);
    expect(second).toEqual([501, 501]);
  });
});

describe("RelayClient sequential jobs in one session", () => {
  it("binds each job to its own handler", () => {
    const { client, socket } = connectClient();
    const first: number[] = [];
    const second: number[] = [];

    const unsubscribeFirst = client.onPendingJob(SESSION_ID, (frame) =>
      first.push(frame.jobId)
    );
    deliver(socket, chunkFrame({ jobId: 10 }));
    deliver(socket, chunkFrame({ jobId: 10, seq: 2, type: "complete" }));
    unsubscribeFirst();

    client.onPendingJob(SESSION_ID, (frame) => second.push(frame.jobId));
    deliver(socket, chunkFrame({ jobId: 11 }));

    expect(first).toEqual([10, 10]);
    expect(second).toEqual([11]);
  });

  it("does not let a late frame from a finished job hijack the next handler", () => {
    const { client, socket } = connectClient();
    const second: number[] = [];

    const unsubscribeFirst = client.onPendingJob(SESSION_ID, () => {
      // first job's stream
    });
    deliver(socket, chunkFrame({ jobId: 10 }));
    unsubscribeFirst();

    client.onPendingJob(SESSION_ID, (frame) => second.push(frame.jobId));
    // Duplicate/late delivery for the job that already finished.
    deliver(socket, chunkFrame({ jobId: 10, seq: 9 }));

    expect(second).toEqual([]);
    expect(client.hasUnboundPendingJob(SESSION_ID)).toBe(true);

    deliver(socket, chunkFrame({ jobId: 11 }));
    expect(second).toEqual([11]);
  });

  it("does not let a pending handler adopt a job already claimed via onJob", () => {
    const { client, socket } = connectClient();
    const byJob: number[] = [];
    const byPending: number[] = [];

    const unsubscribeJob = client.onJob(77, (frame) => byJob.push(frame.jobId));
    unsubscribeJob();

    client.onPendingJob(SESSION_ID, (frame) => byPending.push(frame.jobId));
    deliver(socket, chunkFrame({ jobId: 77 }));

    expect(byJob).toEqual([]);
    expect(byPending).toEqual([]);
  });
});

describe("RelayClient unsubscribe", () => {
  it("stops a pending handler from binding after unsubscribe", () => {
    const { client, socket } = connectClient();
    const received: number[] = [];

    const unsubscribe = client.onPendingJob(SESSION_ID, (frame) =>
      received.push(frame.jobId)
    );
    unsubscribe();
    deliver(socket, chunkFrame({ jobId: 300 }));

    expect(received).toEqual([]);
    expect(client.hasUnboundPendingJob(SESSION_ID)).toBe(false);
  });

  it("stops delivery after the handler has already bound", () => {
    const { client, socket } = connectClient();
    const received: number[] = [];

    const unsubscribe = client.onPendingJob(SESSION_ID, (frame) =>
      received.push(seqOf(frame))
    );
    deliver(socket, chunkFrame({ jobId: 300, seq: 1 }));
    unsubscribe();
    deliver(socket, chunkFrame({ jobId: 300, seq: 2 }));

    expect(received).toEqual([1]);
  });

  it("keeps the classic onJob path working", () => {
    const { client, socket } = connectClient();
    const received: number[] = [];

    const unsubscribe = client.onJob(42, (frame) =>
      received.push(seqOf(frame))
    );
    deliver(socket, chunkFrame({ jobId: 42, seq: 1 }));
    deliver(socket, chunkFrame({ jobId: 42, seq: 2 }));
    unsubscribe();
    deliver(socket, chunkFrame({ jobId: 42, seq: 3 }));

    expect(received).toEqual([1, 2]);
  });
});

describe("RelayClient.bindPendingJob", () => {
  it("binds an unbound handler to the jobId reported by submit", () => {
    const { client, socket } = connectClient();
    const received: number[] = [];

    client.onPendingJob(SESSION_ID, (frame) => received.push(frame.jobId));
    const binding = client.bindPendingJob(SESSION_ID, 55);

    expect(binding).toEqual({ jobId: 55, converged: true });
    expect(client.hasUnboundPendingJob(SESSION_ID)).toBe(false);

    deliver(socket, chunkFrame({ jobId: 55 }));
    expect(received).toEqual([55]);
  });

  it("converges with a first-frame binding instead of creating a second one", () => {
    const { client, socket } = connectClient();
    const received: number[] = [];

    client.onPendingJob(SESSION_ID, (frame) => received.push(seqOf(frame)));
    deliver(socket, chunkFrame({ jobId: 55, seq: 1 }));

    const binding = client.bindPendingJob(SESSION_ID, 55);
    expect(binding).toEqual({ jobId: 55, converged: true });

    // A single callback: the frame is delivered once, not twice.
    deliver(socket, chunkFrame({ jobId: 55, seq: 2 }));
    expect(received).toEqual([1, 2]);
  });

  it("re-binds to the authoritative jobId and reports the divergence", () => {
    const { client, socket } = connectClient();
    const received: number[] = [];

    client.onPendingJob(SESSION_ID, (frame) => received.push(frame.jobId));
    deliver(socket, chunkFrame({ jobId: 55 }));

    const binding = client.bindPendingJob(SESSION_ID, 56);
    expect(binding).toEqual({ jobId: 56, converged: false });

    deliver(socket, chunkFrame({ jobId: 55, seq: 2 }));
    deliver(socket, chunkFrame({ jobId: 56, seq: 2 }));
    expect(received).toEqual([55, 56]);
  });

  it("returns null when the session has no pending handler", () => {
    const { client } = connectClient();
    expect(client.bindPendingJob(SESSION_ID, 1)).toBeNull();
  });
});

describe("RelayClient frame dispatch", () => {
  it("drops an unmatched frame without throwing", () => {
    const { socket } = connectClient();
    expect(() => deliver(socket, chunkFrame({ jobId: 999 }))).not.toThrow();
  });

  it("drops malformed frames without throwing", () => {
    const { client, socket } = connectClient();
    const received: unknown[] = [];
    client.onPendingJob(SESSION_ID, (frame) => received.push(frame));

    expect(() => socket.onmessage?.({ data: "not json" })).not.toThrow();
    expect(() => socket.onmessage?.({ data: 42 })).not.toThrow();
    expect(() =>
      deliver(socket, { type: "chunk", sessionId: SESSION_ID })
    ).not.toThrow();
    expect(() => deliver(socket, { type: "chunk", jobId: 3 })).not.toThrow();

    expect(received).toEqual([]);
    expect(client.hasUnboundPendingJob(SESSION_ID)).toBe(true);
  });

  it("delivers error frames to a pending handler", () => {
    const { client, socket } = connectClient();
    const received: Array<WSFrame | WSErrorFrame> = [];

    client.onPendingJob(SESSION_ID, (frame) => received.push(frame));
    const errorFrame: WSErrorFrame = {
      type: "error",
      code: "WORKER_FAILED",
      jobId: 88,
      sessionId: SESSION_ID,
      droppedSeq: 0,
      message: "worker exploded",
      correlationId: "corr-err",
      ts: 1_700_000_001,
    };
    deliver(socket, errorFrame);

    expect(received).toHaveLength(1);
    expect((received[0] as WSErrorFrame).message).toBe("worker exploded");
  });

  it("does not route lifecycle events to a pending handler", () => {
    const { client, socket } = connectClient();
    const frames: unknown[] = [];
    const lifecycle: unknown[] = [];

    client.onPendingJob(SESSION_ID, (frame) => frames.push(frame));
    client.onLifecycle((event) => lifecycle.push(event));
    deliver(socket, {
      type: "reassignment_required",
      sessionId: SESSION_ID,
      ts: 1,
    });

    expect(frames).toEqual([]);
    expect(lifecycle).toHaveLength(1);
    expect(client.hasUnboundPendingJob(SESSION_ID)).toBe(true);
  });
});

describe("RelayClient tombstones (aborted submissions)", () => {
  it("drains the first frame of an aborted delegated submission instead of letting the next prompt adopt it", () => {
    const { client, socket } = connectClient();
    const next: number[] = [];

    // Prompt A was aborted after broadcast; its jobId was never learned.
    client.tombstonePendingSubmission(SESSION_ID);

    // Prompt B subscribes before either job has produced a frame.
    client.onPendingJob(SESSION_ID, (frame) => next.push(frame.jobId));

    // The orphan job's frames arrive first: drained, and never adopted.
    deliver(socket, chunkFrame({ jobId: 700, seq: 1 }));
    deliver(socket, chunkFrame({ jobId: 700, seq: 2 }));
    expect(next).toEqual([]);

    // The new prompt's own job binds normally once its frames arrive.
    deliver(socket, chunkFrame({ jobId: 701, seq: 1 }));
    deliver(socket, chunkFrame({ jobId: 701, seq: 2 }));
    expect(next).toEqual([701, 701]);
  });

  it("does not count drains as unbound pending handlers", () => {
    const { client } = connectClient();
    client.tombstonePendingSubmission(SESSION_ID);
    expect(client.hasUnboundPendingJob(SESSION_ID)).toBe(false);
  });

  it("drains one orphan per armed drain", () => {
    const { client, socket } = connectClient();
    const next: number[] = [];

    // Two prompts aborted in a row before either produced a frame.
    client.tombstonePendingSubmission(SESSION_ID);
    client.tombstonePendingSubmission(SESSION_ID);
    client.onPendingJob(SESSION_ID, (frame) => next.push(frame.jobId));

    deliver(socket, chunkFrame({ jobId: 800 }));
    deliver(socket, chunkFrame({ jobId: 801 }));
    expect(next).toEqual([]);

    // Drains exhausted: the third unseen job belongs to the live prompt.
    deliver(socket, chunkFrame({ jobId: 802 }));
    expect(next).toEqual([802]);
  });

  it("lets a real pending handler fail on a submit-failure error frame when no drain is armed", () => {
    const { client, socket } = connectClient();
    const received: string[] = [];
    client.onPendingJob(SESSION_ID, (frame) => received.push(frame.type));

    deliver(socket, {
      type: "error",
      jobId: 0,
      sessionId: SESSION_ID,
      ts: 1_700_000_002,
    });
    expect(received).toEqual(["error"]);
  });

  it("swallows an orphan's submit-failure error frame when a drain is armed", () => {
    const { client, socket } = connectClient();
    const next: string[] = [];

    client.tombstonePendingSubmission(SESSION_ID);
    client.onPendingJob(SESSION_ID, (frame) => next.push(frame.type));

    // The aborted job's tx reverted post-broadcast; its error frame must not
    // kill the next prompt's stream.
    deliver(socket, {
      type: "error",
      jobId: 0,
      sessionId: SESSION_ID,
      ts: 1_700_000_002,
    });
    expect(next).toEqual([]);
  });

  it("expires drains after the TTL so a much-later job is adoptable", () => {
    vi.useFakeTimers();
    try {
      const { client, socket } = connectClient();
      const next: number[] = [];

      client.tombstonePendingSubmission(SESSION_ID);
      client.onPendingJob(SESSION_ID, (frame) => next.push(frame.jobId));

      vi.advanceTimersByTime(TOMBSTONE_DRAIN_TTL_MS + 1000);
      deliver(socket, chunkFrame({ jobId: 900 }));
      expect(next).toEqual([900]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("tombstoneJobId drops late frames of a known aborted job", () => {
    const { client, socket } = connectClient();
    const next: number[] = [];

    // Wallet-mode abort: the jobId was learned before the stream closed.
    client.tombstoneJobId(650);
    client.onPendingJob(SESSION_ID, (frame) => next.push(frame.jobId));

    deliver(socket, chunkFrame({ jobId: 650, seq: 1 }));
    expect(next).toEqual([]);
    expect(client.hasUnboundPendingJob(SESSION_ID)).toBe(true);

    deliver(socket, chunkFrame({ jobId: 651, seq: 1 }));
    expect(next).toEqual([651]);
  });

  it("does not drain frames from other sessions", () => {
    const { client, socket } = connectClient();
    const next: number[] = [];

    client.tombstonePendingSubmission(SESSION_ID + 1);
    client.onPendingJob(SESSION_ID, (frame) => next.push(frame.jobId));

    deliver(socket, chunkFrame({ jobId: 910 }));
    expect(next).toEqual([910]);
  });
});

describe("parseGenerationStats", () => {
  const valid: GenerationStats = {
    promptTokens: 12,
    evalTokens: 48,
    tokensPerSecond: 25.5,
    promptEvalMs: 100,
    evalMs: 2000,
    totalMs: 2100,
  };

  it("parses a fully-populated stats payload", () => {
    expect(parseGenerationStats(JSON.stringify(valid))).toEqual(valid);
  });

  it("returns null when required numeric fields are missing", () => {
    expect(parseGenerationStats(JSON.stringify({ evalTokens: 3 }))).toBeNull();
  });

  it("returns null for JSON that does not decode to an object", () => {
    expect(parseGenerationStats(JSON.stringify("nope"))).toBeNull();
  });
});
