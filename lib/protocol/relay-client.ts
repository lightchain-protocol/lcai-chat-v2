/**
 * WebSocket client for the LightChain relay server.
 *
 * Connects to the relay using a JWT from the dispatcher, receives encrypted
 * WSFrame messages, and dispatches them to per-job callbacks for decryption.
 *
 * Frame format (from relay):
 *   { type: "chunk"|"complete"|"metadata"|"error", jobId, sessionId, seq, totalChunks, payload, ts }
 *
 * Error frame format:
 *   { type: "error", code, jobId, sessionId, droppedSeq, message, ts }
 *
 * Subscriptions come in two flavours:
 *   - onJob(jobId, cb)          — classic, requires the jobId up front.
 *   - onPendingJob(sessionId, cb) — registers interest before the jobId exists.
 *     The relay already subscribes us per session, so frames for a job we have
 *     not heard of yet are already on the wire; a pending handler adopts the
 *     first such frame instead of letting it be dropped.
 */

import { $http } from "../http";
import type { ArtifactDescriptor, AudioStreamDescriptor } from "./audio-stream";
import type { SettlementProgress } from "./settlement";
import type { StreamMetricsSnapshot } from "./stream-metrics";
import type { ResponseProof } from "./verify-response";

/**
 * Which content channel a frame carries. Orthogonal to `type`: `type` says
 * where the frame sits in the response lifecycle, `kind` says what is inside.
 *
 * Absent on frames from workers built before typed kinds existed, which is why
 * every reader must treat undefined as "text".
 */
export type FrameKind = "text" | "reasoning" | "artifact" | "audio" | "stats";

export type WSFrame = {
  type: "chunk" | "complete" | "metadata" | "error";
  kind?: FrameKind;
  jobId: number;
  sessionId: number;
  seq: number;
  totalChunks: number;
  payload: string; // base64-encoded encrypted bytes
  signature: string;
  correlationId: string;
  ts: number;
};

/** Normalizes the wire value, mapping the pre-kinds default onto text. */
export function frameKind(frame: { kind?: FrameKind }): FrameKind {
  return frame.kind ?? "text";
}

/**
 * Payload of a `stats` frame: what the model itself measured for the
 * generation. The worker used to discard these, so the UI had no way to show
 * tokens or throughput.
 */
export type GenerationStats = {
  promptTokens: number;
  evalTokens: number;
  thinkingBytes?: number;
  tokensPerSecond: number;
  loadMs?: number;
  promptEvalMs: number;
  evalMs: number;
  totalMs: number;
};

export type WSErrorFrame = {
  type: "error";
  code: string;
  jobId: number;
  sessionId: number;
  droppedSeq: number;
  message: string;
  correlationId: string;
  ts: number;
};

export type FrameCallback = (frame: WSFrame | WSErrorFrame) => void;

export type RelayStatus = "disconnected" | "connecting" | "connected" | "error";

export type LifecycleEvent = {
  type: "reassignment_required" | "reassigned" | "closed";
  sessionId: number;
  reason?: string;
  newWorker?: string;
  ts: number;
};

const LIFECYCLE_TYPES = new Set([
  "reassignment_required",
  "reassigned",
  "closed",
]);

type PendingAssistantMessage = {
  chatId: string;
  messageId: string;
  text: string;
  sources: ProtocolCitationSource[];
  stats: GenerationStats | null;
  proof: ResponseProof | null;
  settlement: SettlementProgress | null;
  metrics: StreamMetricsSnapshot | null;
  /**
   * Final voice-output descriptor (no PCM — audio is live-only). Persisted so
   * a reload still shows the delivered-not-settled badge and content hash.
   */
  audio: AudioStreamDescriptor | null;
  /** Artifact descriptors, persisted with the message (small JSON by wire contract). */
  artifacts: ArtifactDescriptor[];
  protocolMeta: Record<string, unknown>;
};

/**
 * A session-scoped subscription registered before its jobId is known.
 * Becomes an ordinary entry in `jobCallbacks` the moment it binds.
 */
type PendingSessionHandler = {
  callback: FrameCallback;
  /** null until the handler adopts a jobId. */
  boundJobId: number | null;
  /** Set by the unsubscribe function — a cancelled handler never binds. */
  cancelled: boolean;
};

export type PendingJobBinding = {
  /** The jobId the handler is bound to after this call. */
  jobId: number;
  /**
   * false only when the handler had already adopted a *different* jobId from
   * a first frame and had to be re-bound to the authoritative id supplied by
   * the caller. A false here means frames from a foreign job may already have
   * been delivered to this callback.
   */
  converged: boolean;
};

/**
 * Thrown by `onPendingJob` when the session already has a pending handler that
 * has not bound yet. Refusing is deliberate: silently replacing the incumbent
 * would strand its job's frames with no subscriber.
 */
export class PendingJobConflictError extends Error {
  readonly sessionId: number;

  constructor(sessionId: number) {
    super(
      `Session ${sessionId} already has an unbound pending job handler; ` +
        "resolve or unsubscribe it before registering another"
    );
    this.name = "PendingJobConflictError";
    this.sessionId = sessionId;
  }
}

/**
 * Upper bound on remembered jobIds. Only used to stop a pending handler from
 * adopting a late frame belonging to a job we have already served, so an
 * approximate, bounded memory is sufficient.
 */
const MAX_OBSERVED_JOB_IDS = 1024;

/**
 * How long a session-scoped drain stays armed after an aborted submission.
 * Matches the transport's no-answer watchdog: an orphaned job must produce its
 * first frame within its 120 s on-chain deadline plus settlement slack, so any
 * frame arriving later than this is treated as belonging to a newer prompt.
 */
export const TOMBSTONE_DRAIN_TTL_MS = 180_000;

export type ProtocolCitationSource = {
  position: number;
  title: string;
  url: string;
  description: string;
};

/**
 * RelayClient manages a WebSocket connection to the relay server.
 * Consumers register per-job callbacks to receive encrypted frames.
 */
export class RelayClient {
  private ws: WebSocket | null = null;
  private readonly jobCallbacks = new Map<number, FrameCallback>();
  /** At most one entry per session; see onPendingJob. */
  private readonly pendingSessionHandlers = new Map<
    number,
    PendingSessionHandler
  >();
  /** Insertion-ordered, capped at MAX_OBSERVED_JOB_IDS. */
  private readonly observedJobIds = new Set<number>();
  private lifecycleCallback?: (event: LifecycleEvent) => void;
  private reconnectCallback?: () => void;
  private status: RelayStatus = "disconnected";
  private onStatusChange?: (status: RelayStatus) => void;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly maxReconnectDelay = 30_000;
  private reconnectAttempt = 0;
  private readonly relayUrl: string;
  private token: string;
  /**
   * Per-session count of aborted submissions whose jobs may still be live
   * on-chain, stored as drain expiry timestamps (ms). While a drain is armed,
   * the next frame on that session carrying an unobserved jobId is swallowed
   * and its jobId observed, so frames from an abandoned job can never be
   * adopted by the next prompt's pending handler (cross-answer hijack).
   */
  private readonly sessionDrains = new Map<number, number[]>();
  private readonly pendingAssistantMessages = new Map<
    number,
    PendingAssistantMessage
  >();
  private readonly pendingAssistantSources = new Map<
    number,
    ProtocolCitationSource[]
  >();

  constructor(relayUrl: string, token: string) {
    this.relayUrl = relayUrl;
    this.token = token;
  }

  setOnStatusChange(cb: (status: RelayStatus) => void) {
    this.onStatusChange = cb;
  }

  getStatus(): RelayStatus {
    return this.status;
  }

  /**
   * Updates the JWT token. If already connected, reconnects with the new token.
   */
  updateToken(token: string) {
    this.token = token;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.disconnect();
      this.connect();
    }
  }

  /**
   * Establishes the WebSocket connection with JWT auth.
   */
  connect() {
    if (this.ws) return;

    this.setStatus("connecting");

    // Append token as query param since WebSocket API doesn't support custom headers.
    // The relay also accepts ?token= as an auth mechanism.
    const url = new URL(this.relayUrl);
    url.searchParams.set("token", this.token);

    const ws = new WebSocket(url.toString());

    ws.onopen = () => {
      const wasReconnect = this.reconnectAttempt > 0;
      this.reconnectAttempt = 0;
      this.setStatus("connected");
      if (wasReconnect) {
        this.reconnectCallback?.();
      }
    };

    ws.onmessage = (event) => {
      this.handleMessage(event.data);
    };

    ws.onclose = (event) => {
      this.ws = null;
      if (event.code === 1000) {
        // Normal close
        this.setStatus("disconnected");
        return;
      }
      this.setStatus("error");
      this.scheduleReconnect();
    };

    ws.onerror = () => {
      // onerror is always followed by onclose, so we handle status there
    };

    this.ws = ws;
  }

  /**
   * Registers a callback for frames belonging to a specific job.
   * Returns an unsubscribe function.
   */
  onJob(jobId: number, callback: FrameCallback): () => void {
    this.observeJobId(jobId);
    this.jobCallbacks.set(jobId, callback);
    return () => {
      if (this.jobCallbacks.get(jobId) === callback) {
        this.jobCallbacks.delete(jobId);
      }
    };
  }

  /**
   * Registers interest in the *next* job of a session, before its jobId is
   * known. The handler binds to the first frame on that session carrying a
   * jobId this client has never observed, after which it behaves exactly like
   * an `onJob` subscription.
   *
   * Guarantees:
   *  - At most one unbound pending handler per session. A second registration
   *    throws `PendingJobConflictError` rather than replacing the incumbent,
   *    so frames can never be silently orphaned. Registering again *after* the
   *    incumbent has bound is allowed and safe — the incumbent has already
   *    moved onto the normal per-job path.
   *  - A handler binds at most once, and only to a jobId never seen by this
   *    client. Late or duplicate frames from an already-served job are dropped
   *    instead of hijacking the next prompt's handler.
   *  - Unsubscribing removes both the pending registration and the per-job
   *    binding it may have acquired.
   *
   * Returns an unsubscribe function, matching `onJob`.
   *
   * @throws PendingJobConflictError if the session already has an unbound
   *   pending handler.
   */
  onPendingJob(sessionId: number, callback: FrameCallback): () => void {
    const incumbent = this.pendingSessionHandlers.get(sessionId);
    if (incumbent && !incumbent.cancelled && incumbent.boundJobId === null) {
      throw new PendingJobConflictError(sessionId);
    }

    const handler: PendingSessionHandler = {
      callback,
      boundJobId: null,
      cancelled: false,
    };
    this.pendingSessionHandlers.set(sessionId, handler);

    return () => {
      handler.cancelled = true;
      if (this.pendingSessionHandlers.get(sessionId) === handler) {
        this.pendingSessionHandlers.delete(sessionId);
      }
      if (
        handler.boundJobId !== null &&
        this.jobCallbacks.get(handler.boundJobId) === handler.callback
      ) {
        this.jobCallbacks.delete(handler.boundJobId);
      }
    };
  }

  /** True when `onPendingJob(sessionId, …)` would throw. */
  hasUnboundPendingJob(sessionId: number): boolean {
    const handler = this.pendingSessionHandlers.get(sessionId);
    return (
      handler !== undefined && !handler.cancelled && handler.boundJobId === null
    );
  }

  /**
   * Tombstones a known jobId: its late frames are observed-and-dropped and can
   * never be adopted by a future pending handler. Used when a submission is
   * aborted after the jobId is already known (wallet-mode submit returned).
   */
  tombstoneJobId(jobId: number) {
    this.observeJobId(jobId);
  }

  /**
   * Arms a one-shot drain on a session for an aborted delegated submission,
   * whose jobId is never known client-side (consumer-api answers at broadcast
   * with `jobId: null`). The job may still be live on-chain; when its first
   * frame arrives the drain swallows it and observes the jobId, so the frames
   * render nowhere instead of being adopted by the next prompt's handler.
   *
   * Drains are deliberately not counted by `hasUnboundPendingJob`: an aborted
   * submission must not force the next prompt onto the legacy subscribe path.
   * The inherent ambiguity (an unseen frame could be the orphan's or the new
   * job's) is resolved in the orphan's favour because its frames were published
   * first; a misattribution is bounded by the transport's no-answer watchdog.
   */
  tombstonePendingSubmission(sessionId: number) {
    const list = this.sessionDrains.get(sessionId) ?? [];
    list.push(Date.now() + TOMBSTONE_DRAIN_TTL_MS);
    this.sessionDrains.set(sessionId, list);
  }

  /** Consumes one armed, unexpired drain for the session. */
  private consumeDrain(sessionId: number): boolean {
    const list = this.sessionDrains.get(sessionId);
    if (!list) return false;
    const now = Date.now();
    while (list.length > 0 && list[0] <= now) {
      list.shift();
    }
    if (list.length === 0) {
      this.sessionDrains.delete(sessionId);
      return false;
    }
    list.shift();
    if (list.length === 0) {
      this.sessionDrains.delete(sessionId);
    }
    return true;
  }

  /**
   * Binds the session's pending handler to an authoritative jobId — used when
   * the submit call does return one. Converges with first-frame binding rather
   * than creating a second subscription:
   *  - unbound handler        → binds to `jobId`
   *  - already bound to it    → no-op
   *  - bound to a different id → re-bound to `jobId`, reported as not converged
   *
   * Returns null when the session has no live pending handler.
   */
  bindPendingJob(sessionId: number, jobId: number): PendingJobBinding | null {
    const handler = this.pendingSessionHandlers.get(sessionId);
    if (!handler || handler.cancelled) return null;

    if (handler.boundJobId === jobId) {
      return { jobId, converged: true };
    }

    if (handler.boundJobId === null) {
      this.bindHandler(handler, jobId);
      return { jobId, converged: true };
    }

    if (this.jobCallbacks.get(handler.boundJobId) === handler.callback) {
      this.jobCallbacks.delete(handler.boundJobId);
    }
    this.bindHandler(handler, jobId);
    return { jobId, converged: false };
  }

  /**
   * Registers a callback for session lifecycle events
   * (reassignment_required, reassigned, closed).
   * Returns an unsubscribe function.
   */
  onLifecycle(callback: (event: LifecycleEvent) => void): () => void {
    this.lifecycleCallback = callback;
    return () => {
      this.lifecycleCallback = undefined;
    };
  }

  /**
   * Registers a callback that fires after a successful WebSocket reconnect
   * (not on the initial connection).
   */
  onReconnect(callback: () => void) {
    this.reconnectCallback = callback;
  }

  /**
   * Gracefully disconnects from the relay.
   */
  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onclose = null; // Prevent reconnect on intentional close
      this.ws.close(1000, "client disconnect");
      this.ws = null;
    }
    this.setStatus("disconnected");
  }

  beginAssistantMessage(args: {
    jobId: number;
    chatId: string;
    messageId: string;
    protocolMeta: Record<string, unknown>;
  }) {
    const sources = this.pendingAssistantSources.get(args.jobId) ?? [];
    this.pendingAssistantSources.delete(args.jobId);
    this.pendingAssistantMessages.set(args.jobId, {
      chatId: args.chatId,
      messageId: args.messageId,
      text: "",
      sources,
      stats: null,
      proof: null,
      settlement: null,
      metrics: null,
      audio: null,
      artifacts: [],
      protocolMeta: args.protocolMeta,
    });
  }

  appendAssistantDelta(jobId: number, delta: string) {
    const pending = this.pendingAssistantMessages.get(jobId);
    if (!pending) return;
    pending.text += delta;
  }

  resetAssistantText(jobId: number) {
    const pending = this.pendingAssistantMessages.get(jobId);
    if (!pending) return;
    pending.text = "";
  }

  replaceAssistantText(jobId: number, text: string) {
    const pending = this.pendingAssistantMessages.get(jobId);
    if (!pending) return;
    pending.text = text;
  }

  /**
   * Attach the model's own generation stats to the message being assembled.
   * Stored as a data part on persist, the same way search sources are, so the
   * token count and throughput survive a reload instead of living only in the
   * live stream.
   */
  setAssistantStats(jobId: number, stats: GenerationStats) {
    const pending = this.pendingAssistantMessages.get(jobId);
    if (!pending) return;
    pending.stats = stats;
  }

  /**
   * Attach the verification evidence captured from the terminal frame, so the
   * proof panel still works after a reload. Small by design — the ciphertext
   * it was derived from is not kept.
   */
  setAssistantProof(jobId: number, proof: ResponseProof) {
    const pending = this.pendingAssistantMessages.get(jobId);
    if (!pending) return;
    pending.proof = proof;
  }

  setAssistantSources(jobId: number, sources: ProtocolCitationSource[]) {
    const pending = this.pendingAssistantMessages.get(jobId);
    if (pending) {
      pending.sources = sources;
      return;
    }
    this.pendingAssistantSources.set(jobId, sources);
  }

  /**
   * Attach the final settlement timeline (escrow → settle) so the reload view
   * shows the same completed journey the live stream rendered. Verification is
   * deliberately excluded — it is recomputed from the proof at render time.
   */
  setAssistantSettlement(jobId: number, settlement: SettlementProgress) {
    const pending = this.pendingAssistantMessages.get(jobId);
    if (!pending) return;
    pending.settlement = settlement;
  }

  /**
   * Attach the browser-measured timing (TTFT, final rolling rate). The worker's
   * own throughput is in stats; this covers what only the browser can see.
   */
  setAssistantMetrics(jobId: number, metrics: StreamMetricsSnapshot) {
    const pending = this.pendingAssistantMessages.get(jobId);
    if (!pending) return;
    pending.metrics = metrics;
  }

  /**
   * Attach the voice-output descriptor. Only the descriptor persists — PCM
   * chunks are live-playback bytes and are gone after reload, exactly like
   * the response ciphertext.
   */
  setAssistantAudio(jobId: number, audio: AudioStreamDescriptor) {
    const pending = this.pendingAssistantMessages.get(jobId);
    if (!pending) return;
    pending.audio = audio;
  }

  /** Append one artifact descriptor; order matches delivery order. */
  addAssistantArtifact(jobId: number, artifact: ArtifactDescriptor) {
    const pending = this.pendingAssistantMessages.get(jobId);
    if (!pending) return;
    pending.artifacts.push(artifact);
  }

  discardAssistantMessage(jobId: number) {
    this.pendingAssistantMessages.delete(jobId);
    this.pendingAssistantSources.delete(jobId);
  }

  async completeAssistantMessage(jobId: number) {
    const pending = this.pendingAssistantMessages.get(jobId);
    this.pendingAssistantMessages.delete(jobId);
    if (!pending) return;
    if (!pending.text.trim()) return;

    const parts: Record<string, unknown>[] = [];
    if (pending.sources.length > 0) {
      parts.push({
        type: "data-webSearchSources",
        id: `protocol-web-search-${jobId}`,
        data: { sources: pending.sources },
      });
    }
    if (pending.stats) {
      parts.push({
        type: "data-generationStats",
        id: `protocol-stats-${jobId}`,
        data: pending.stats,
      });
    }
    if (pending.proof) {
      parts.push({
        type: "data-responseProof",
        id: `protocol-proof-${jobId}`,
        data: pending.proof,
      });
    }
    if (pending.settlement) {
      parts.push({
        type: "data-settlement",
        id: `protocol-settlement-${jobId}`,
        data: pending.settlement,
      });
    }
    if (pending.metrics) {
      parts.push({
        type: "data-streamMetrics",
        id: `protocol-metrics-${jobId}`,
        data: pending.metrics,
      });
    }
    if (pending.audio) {
      parts.push({
        type: "data-audioStream",
        id: `protocol-audio-${jobId}`,
        data: pending.audio,
      });
    }
    for (const [index, artifact] of pending.artifacts.entries()) {
      parts.push({
        type: "data-artifact",
        id: `protocol-artifact-${jobId}-${index}`,
        data: artifact,
      });
    }
    parts.push({
      type: "data-protocolFinal",
      id: `protocol-final-${jobId}`,
      data: { text: pending.text },
    });
    parts.push({ type: "text", text: pending.text });

    const response = await $http.post(`/api/chat/${pending.chatId}/messages`, {
      id: pending.messageId,
      sessionId: pending.protocolMeta?.sessionId ?? null,
      role: "assistant",
      parts,
      attachments: [],
      jobId,
      completionState: "completed",
      relaySource: "websocket",
      protocolMeta: pending.protocolMeta,
    });

    if (!response.ok) {
      throw new Error(
        `Failed to persist assistant message: ${response.status} ${response.statusText}`
      );
    }
  }

  private handleMessage(data: unknown) {
    if (typeof data !== "string") return;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(data);
    } catch {
      return; // Ignore malformed frames
    }

    // Lifecycle events (reassignment_required, reassigned, closed) are
    // dispatched separately from job response frames.
    if (typeof parsed.type === "string" && LIFECYCLE_TYPES.has(parsed.type)) {
      this.lifecycleCallback?.(parsed as unknown as LifecycleEvent);
      return;
    }

    const frame = parsed as unknown as WSFrame | WSErrorFrame;
    const callback =
      this.jobCallbacks.get(frame.jobId) ?? this.adoptFrame(frame);
    // Frames matching neither a job callback nor a pending handler stay
    // dropped, exactly as before.
    callback?.(frame);
  }

  /**
   * Offers an unmatched frame to the pending handler of its session. Binds and
   * returns the callback on success, null when the frame should be dropped.
   */
  private adoptFrame(frame: WSFrame | WSErrorFrame): FrameCallback | null {
    if (
      typeof frame.jobId !== "number" ||
      typeof frame.sessionId !== "number"
    ) {
      return null;
    }
    // Already served this job: its subscriber unsubscribed and this is a late
    // or duplicate frame. Adopting it would bind the next prompt's handler to
    // the previous prompt's job.
    if (this.observedJobIds.has(frame.jobId)) return null;

    // Aborted submissions on this session get their frames swallowed first.
    // The drain observes the jobId, so the rest of the orphan job's frames
    // drop via the check above rather than hijacking a later prompt.
    if (this.consumeDrain(frame.sessionId)) {
      this.observeJobId(frame.jobId);
      return null;
    }

    const handler = this.pendingSessionHandlers.get(frame.sessionId);
    if (!handler || handler.cancelled || handler.boundJobId !== null) {
      return null;
    }

    this.bindHandler(handler, frame.jobId);
    return handler.callback;
  }

  private bindHandler(handler: PendingSessionHandler, jobId: number) {
    handler.boundJobId = jobId;
    this.observeJobId(jobId);
    this.jobCallbacks.set(jobId, handler.callback);
  }

  private observeJobId(jobId: number) {
    if (this.observedJobIds.has(jobId)) return;
    this.observedJobIds.add(jobId);
    if (this.observedJobIds.size > MAX_OBSERVED_JOB_IDS) {
      const oldest = this.observedJobIds.values().next().value;
      if (oldest !== undefined) this.observedJobIds.delete(oldest);
    }
  }

  private setStatus(status: RelayStatus) {
    this.status = status;
    this.onStatusChange?.(status);
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    const delay = Math.min(
      1000 * 2 ** this.reconnectAttempt,
      this.maxReconnectDelay
    );
    this.reconnectAttempt++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }
}
