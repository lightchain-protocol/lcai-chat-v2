/**
 * WebSocket client for the LightChain relay server.
 *
 * Connects to the relay using a JWT from the dispatcher, receives encrypted
 * WSFrame messages, and dispatches them to per-job callbacks for decryption.
 *
 * Frame format (from relay):
 *   { type: "chunk"|"complete"|"error", jobId, sessionId, seq, totalChunks, payload, ts }
 *
 * Error frame format:
 *   { type: "error", code, jobId, sessionId, droppedSeq, message, ts }
 */

import { $http } from "../http";

export type WSFrame = {
  type: "chunk" | "complete" | "error";
  jobId: number;
  sessionId: number;
  seq: number;
  totalChunks: number;
  payload: string; // base64-encoded encrypted bytes
  signature: string;
  correlationId: string;
  ts: number;
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
  protocolMeta: Record<string, unknown>;
};

/**
 * RelayClient manages a WebSocket connection to the relay server.
 * Consumers register per-job callbacks to receive encrypted frames.
 */
export class RelayClient {
  private ws: WebSocket | null = null;
  private readonly jobCallbacks = new Map<number, FrameCallback>();
  private lifecycleCallback?: (event: LifecycleEvent) => void;
  private reconnectCallback?: () => void;
  private authFailureCallback?: () => Promise<void>;
  private status: RelayStatus = "disconnected";
  private onStatusChange?: (status: RelayStatus) => void;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly maxReconnectDelay = 30_000;
  private reconnectAttempt = 0;
  private consecutiveAuthFailures = 0;
  /** Stop invoking the auth-failure callback after this many consecutive failures to avoid wallet-popup loops on a structurally invalid session. */
  private readonly MAX_AUTH_FAILURES = 3;
  private readonly relayUrl: string;
  private token: string;
  private readonly pendingAssistantMessages = new Map<
    number,
    PendingAssistantMessage
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
   * Updates the JWT token and forces a reconnect using it.
   *
   * Unlike the naive "only reconnect if OPEN" approach, this handles every
   * lifecycle state: a pending reconnect timer is cancelled, an existing
   * socket (OPEN/CONNECTING/CLOSING) is closed cleanly, and a fresh connect
   * is kicked off with the backoff counter reset. The counter reset matters —
   * after a successful token refresh we want the next WS open to be treated
   * as a first attempt, not as attempt N of an exponential backoff.
   */
  updateToken(token: string) {
    this.token = token;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onclose = null;
      try {
        this.ws.close(1000, "token refresh");
      } catch {
        // close() can throw on a socket that's already closed — ignore.
      }
      this.ws = null;
    }
    this.reconnectAttempt = 0;
    this.connect();
  }

  /**
   * Establishes the WebSocket connection with JWT auth.
   *
   * Auth-failure detection: the browser WebSocket API hides pre-upgrade HTTP
   * responses, so a 401 from the relay surfaces as a generic code-1006
   * CloseEvent *before* onopen fires. We use the pattern "closed with 1006
   * AND onopen never fired" as the canonical auth-failure heuristic (the
   * same one libraries like reconnecting-websocket use), and delegate
   * recovery to the transport via onAuthFailure.
   */
  connect() {
    if (this.ws) return;

    this.setStatus("connecting");

    // Append token as query param since WebSocket API doesn't support custom headers.
    // The relay also accepts ?token= as an auth mechanism.
    const url = new URL(this.relayUrl);
    url.searchParams.set("token", this.token);

    const ws = new WebSocket(url.toString());
    let opened = false;

    ws.onopen = () => {
      opened = true;
      this.consecutiveAuthFailures = 0;
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

      // Auth-failure heuristic: abnormal close before the handshake completes.
      if (!opened && event.code === 1006) {
        this.consecutiveAuthFailures++;
        if (
          this.consecutiveAuthFailures <= this.MAX_AUTH_FAILURES &&
          this.authFailureCallback
        ) {
          this.setStatus("error");
          // Transport refreshes the token and calls updateToken(), which
          // cancels any pending reconnect and initiates a fresh connect.
          this.authFailureCallback().catch(() => {
            // Refresh itself failed — fall back to normal backoff so we
            // don't leave the client in a permanent error state.
            this.scheduleReconnect();
          });
          return;
        }
        // Exceeded the cap — stop retrying. Transport surfaces the error
        // via status change; user must reload or start a new session.
        this.setStatus("error");
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
    this.jobCallbacks.set(jobId, callback);
    return () => {
      this.jobCallbacks.delete(jobId);
    };
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
   * Registers a callback invoked when a WS handshake appears to have failed
   * due to auth (close code 1006 before onopen). The callback is responsible
   * for refreshing the JWT and calling updateToken() to retry the connect.
   *
   * The callback is throttled to MAX_AUTH_FAILURES consecutive failures so
   * that a structurally invalid token doesn't produce an infinite refresh
   * loop (and, if gateway-auth is also expired, infinite wallet popups).
   */
  onAuthFailure(callback: () => Promise<void>) {
    this.authFailureCallback = callback;
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
    this.pendingAssistantMessages.set(args.jobId, {
      chatId: args.chatId,
      messageId: args.messageId,
      text: "",
      protocolMeta: args.protocolMeta,
    });
  }

  appendAssistantDelta(jobId: number, delta: string) {
    const pending = this.pendingAssistantMessages.get(jobId);
    if (!pending) return;
    pending.text += delta;
  }

  discardAssistantMessage(jobId: number) {
    this.pendingAssistantMessages.delete(jobId);
  }

  async completeAssistantMessage(jobId: number) {
    const pending = this.pendingAssistantMessages.get(jobId);
    this.pendingAssistantMessages.delete(jobId);
    if (!pending) return;
    if (!pending.text.trim()) return;

    const response = await $http.post(`/api/chat/${pending.chatId}/messages`, {
      id: pending.messageId,
      sessionId: pending.protocolMeta?.sessionId ?? null,
      role: "assistant",
      parts: [{ type: "text", text: pending.text }],
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
    const callback = this.jobCallbacks.get(frame.jobId);
    if (callback) {
      callback(frame);
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
