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

type RelayPersistenceConfig = {
  apiBaseUrl: string;
  getAuthToken: () => string | null;
};

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
  private status: RelayStatus = "disconnected";
  private onStatusChange?: (status: RelayStatus) => void;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly maxReconnectDelay = 30_000;
  private reconnectAttempt = 0;
  private readonly relayUrl: string;
  private token: string;
  private readonly persistence: RelayPersistenceConfig | null;
  private readonly pendingAssistantMessages = new Map<
    number,
    PendingAssistantMessage
  >();

  constructor(
    relayUrl: string,
    token: string,
    persistence?: RelayPersistenceConfig
  ) {
    this.relayUrl = relayUrl;
    this.token = token;
    this.persistence = persistence ?? null;
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
      this.reconnectAttempt = 0;
      this.setStatus("connected");
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
    this.jobCallbacks.set(jobId, callback);
    return () => {
      this.jobCallbacks.delete(jobId);
    };
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
    if (!pending || !this.persistence) return;
    if (!pending.text.trim()) return;

    const token = this.persistence.getAuthToken();
    if (!token) {
      throw new Error("Missing auth token for assistant message persistence");
    }

    const response = await fetch(
      `${this.persistence.apiBaseUrl}/api/chat/${pending.chatId}/messages`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          id: pending.messageId,
          role: "assistant",
          parts: [{ type: "text", text: pending.text }],
          attachments: [],
          completionState: "completed",
          relaySource: "websocket",
          protocolMeta: pending.protocolMeta,
        }),
      }
    );

    if (!response.ok) {
      throw new Error(
        `Failed to persist assistant message: ${response.status} ${response.statusText}`
      );
    }
  }

  private handleMessage(data: unknown) {
    if (typeof data !== "string") return;

    let frame: WSFrame | WSErrorFrame;
    try {
      frame = JSON.parse(data);
    } catch {
      return; // Ignore malformed frames
    }

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
