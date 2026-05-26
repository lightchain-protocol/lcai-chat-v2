/**
 * Custom ChatTransport for the LightChain protocol.
 *
 * Replaces DefaultChatTransport when NEXT_PUBLIC_USE_PROTOCOL=true.
 * Instead of hitting /api/chat, it:
 *   1. Initializes an on-chain session (if not already done)
 *   2. Encrypts the user's prompt with the session key
 *   3. Submits the encrypted blob via gateway + on-chain job via wallet
 *   4. Receives encrypted response chunks via relay WebSocket
 *   5. Decrypts and emits as a data stream for useChat consumption
 *
 * NOTE: Requires relay server to accept JWT via query parameter (?token=).
 * A small relay modification is needed since the browser WebSocket API
 * doesn't support custom headers.
 */

import type { GatewayClient } from "./gateway-client";
import type {
  LifecycleEvent,
  ProtocolCitationSource,
  WSErrorFrame,
  WSFrame,
} from "./relay-client";
import { RelayClient } from "./relay-client";
import type { SessionManagerConfig } from "./session";
import {
  MaxReassignmentsError,
  MissingDisputerKeyError,
  SessionManager,
} from "./session";

export type FailoverStatus =
  | "none"
  | "reassigning"
  | "rewrapping"
  | "failed"
  | "rollover_required";

type ProtocolTransportConfig = SessionManagerConfig & {
  persistence: {
    persistUserMessage: (args: {
      chatId: string;
      sessionId: number | null;
      message: {
        id?: string;
        role: string;
        parts?: Array<{ type: string; text?: string }>;
      };
      selectedVisibilityType?: string;
      systemPrompt?: string | null;
    }) => Promise<void>;
  };
  /** Called after the user message is stored so the chat row exists in the API. */
  registerProtocolSession?: (args: {
    chatId: string;
    sessionId: number;
    modelId: string;
  }) => Promise<void>;
};

/**
 * ProtocolTransport wraps session management, encryption, and relay delivery
 * into a ChatTransport-compatible interface for AI SDK's useChat hook.
 *
 * The transport returns a synthetic Response whose body is a ReadableStream
 * encoding decrypted relay frames in AI SDK data stream protocol format.
 */
export class ProtocolTransport {
  private readonly sessionMgr: SessionManager;
  private readonly gateway: GatewayClient;
  private relayClient: RelayClient | null = null;
  private readonly persistence: ProtocolTransportConfig["persistence"];
  private readonly registerProtocolSession?: ProtocolTransportConfig["registerProtocolSession"];
  /** Dedupes Consumer API PUTs for the same on-chain session id. */
  private lastRegisteredApiSessionId: number | null = null;
  private onSessionStatus?: (status: string) => void;
  private onFailoverStatusChange?: (status: FailoverStatus) => void;
  private failoverPromise: Promise<void> | null = null;

  constructor(config: ProtocolTransportConfig) {
    const { persistence, registerProtocolSession, ...sessionConfig } = config;
    this.sessionMgr = new SessionManager(sessionConfig);
    this.gateway = sessionConfig.gateway;
    this.persistence = persistence;
    this.registerProtocolSession = registerProtocolSession;
  }

  setOnSessionStatus(cb: (status: string) => void) {
    this.onSessionStatus = cb;
    this.sessionMgr.setOnStatusChange(cb);
  }

  setOnFailoverStatus(cb: (status: FailoverStatus) => void) {
    this.onFailoverStatusChange = cb;
  }

  get sessionStatus() {
    return this.sessionMgr.status;
  }

  /**
   * The session's bound worker's heartbeat-advertised capability set
   * (web-search epic, Story 16). Empty list = no opt-in capabilities; the
   * chat input renders affected toggles disabled with a tooltip.
   */
  get workerCapabilities(): string[] {
    return this.sessionMgr.workerCapabilities;
  }

  /**
   * Public retry entry point for the UI banner.
   * Checks on-chain state first to resume partial failover correctly:
   * if reassignSession() already succeeded, skips straight to rewrap.
   */
  async retryFailover(): Promise<void> {
    this.failoverPromise = null;
    this.setFailoverStatus("none");

    // Check if a previous attempt already moved the contract to Reassigning
    try {
      const state = await this.sessionMgr.getOnChainSessionState();
      if (state.status === 1) {
        // Already reassigned on-chain — skip to rewrap
        this.failoverPromise = this.performFailover({
          skipReassign: true,
          newWorker: state.worker,
        }).finally(() => {
          this.failoverPromise = null;
        });
        await this.failoverPromise;
        return;
      }
    } catch {
      // Can't read chain state — fall through to full failover
    }

    await this.handleFailover();
  }

  /**
   * Resets session and relay for "Start New Session" action.
   */
  startNewSession() {
    this.failoverPromise = null;
    this.setFailoverStatus("none");
    this.relayClient?.disconnect();
    this.relayClient = null;
    this.sessionMgr.reset();
    this.onSessionStatus?.("idle");
  }

  /**
   * Implements the ChatTransport.sendMessages interface.
   *
   * Extracts the last user message text, submits the job (encrypt + blob +
   * on-chain TX via wallet), and returns a Response with a streaming body
   * fed by relay WebSocket frames.
   */
  async sendMessages(options: {
    messages: Array<{
      role: string;
      parts?: Array<{ type: string; text?: string }>;
    }>;
    body?: Record<string, unknown>;
    headers?: Record<string, string>;
    signal?: AbortSignal;
  }): Promise<{ response: Response }> {
    // Initialize session on first message. enableWebSearch in the body
    // doubles as the signal to request a search-capable worker at
    // session-create time — once the session is bound, the toggle gates
    // the per-message side-channel (web-search epic, Story 16).
    const enableWebSearch = options.body?.enableWebSearch === true;
    await this.sessionMgr.initialize(
      enableWebSearch ? { requiredCapabilities: ["search"] } : undefined,
    );

    // Ensure relay is connected
    this.ensureRelayConnected();

    // Extract plaintext from the last user message
    const lastMessage = options.messages.at(-1);
    if (!lastMessage) {
      throw new Error("No messages provided");
    }
    const plaintext = extractTextFromMessage(lastMessage);
    if (!plaintext) {
      throw new Error("No text content in last message");
    }

    const chatId = getChatId(options.body);
    if (!chatId) {
      throw new Error("Chat ID is required for protocol message persistence");
    }

    // Wait for any in-progress failover to complete before submitting.
    // If failover failed terminally, the rejection propagates to the caller.
    if (this.failoverPromise) {
      await this.failoverPromise;
    }

    // Guard: if session is not ready after failover (e.g. terminal failure
    // was caught elsewhere), don't attempt to submit a job.
    if (this.sessionMgr.status !== "ready") {
      throw new Error("Session is not ready — recovery may be required");
    }

    // Submit job: encrypt → blob upload → on-chain TX via user's wallet.
    // searchEnabled rides through SessionManager.submitJob into the gateway
    // blob upload, which writes the side-channel the dispatcher reads.
    const { jobId } = await this.sessionMgr.submitJob(plaintext, {
      searchEnabled: enableWebSearch,
    });

    // We persist the user message after the job is submitted to ensure the job ID is available for the assistant message.
    await this.persistence.persistUserMessage({
      chatId,
      sessionId: this.sessionMgr.sessionId,
      message: lastMessage,
      selectedVisibilityType:
        typeof options.body?.selectedVisibilityType === "string"
          ? options.body.selectedVisibilityType
          : undefined,
      systemPrompt:
        typeof options.body?.systemPrompt === "string" ||
        options.body?.systemPrompt === null
          ? (options.body.systemPrompt as string | null)
          : undefined,
    });

    await this.registerProtocolSessionWithServerIfNeeded(chatId);

    // Create a streaming response from relay WebSocket frames
    const stream = this.createResponseStream(jobId, chatId, options.signal);

    return {
      response: new Response(stream, {
        headers: { "Content-Type": "text/event-stream; charset=utf-8" },
      }),
    };
  }

  /**
   * Disconnects relay and clears in-memory session state without removing
   * sessionStorage — use when switching chats or unmounting the composer.
   */
  release() {
    this.relayClient?.disconnect();
    this.relayClient = null;
    this.lastRegisteredApiSessionId = null;
    this.failoverPromise = null;
    this.setFailoverStatus("none");
    this.sessionMgr.release();
  }

  /**
   * Disconnects relay and clears persisted protocol state (wallet disconnect).
   */
  destroy() {
    this.relayClient?.disconnect();
    this.relayClient = null;
    this.lastRegisteredApiSessionId = null;
    this.failoverPromise = null;
    this.setFailoverStatus("none");
    this.sessionMgr.reset();
  }

  private async registerProtocolSessionWithServerIfNeeded(
    chatId: string
  ): Promise<void> {
    if (!this.registerProtocolSession) return;
    const sessionId = this.sessionMgr.sessionId;
    if (sessionId === null) return;
    if (this.lastRegisteredApiSessionId === sessionId) return;
    await this.registerProtocolSession({
      chatId,
      sessionId,
      modelId: this.sessionMgr.resolvedModelId,
    });
    this.lastRegisteredApiSessionId = sessionId;
  }

  private ensureRelayConnected() {
    const relayUrl = this.sessionMgr.getRelayUrl();
    const relayToken = this.sessionMgr.relayToken;
    if (!relayUrl || !relayToken) {
      throw new Error("Relay URL or token not available");
    }

    if (this.relayClient) {
      const status = this.relayClient.getStatus();
      if (status === "connected" || status === "connecting") {
        return;
      }
      // WebSocket is dead — reconnect.
      this.relayClient.disconnect();
      this.relayClient = null;
    }

    this.relayClient = new RelayClient(relayUrl, relayToken);
    this.relayClient.onLifecycle((event) => this.handleLifecycleEvent(event));
    this.relayClient.onReconnect(() => this.handleReconnect());
    this.relayClient.connect();
  }

  private setFailoverStatus(status: FailoverStatus) {
    this.onFailoverStatusChange?.(status);
  }

  private handleLifecycleEvent(event: LifecycleEvent) {
    switch (event.type) {
      case "reassignment_required":
        this.handleFailover().catch((err) => {
          console.warn("Lifecycle-triggered failover failed", err);
        });
        break;
      case "reassigned":
        // Informational — client verifies from contract during failover
        break;
      case "closed":
        this.sessionMgr.reset();
        this.relayClient?.disconnect();
        this.relayClient = null;
        this.onSessionStatus?.("idle");
        break;
      default:
        // Unknown lifecycle event — ignore rather than crash.
        break;
    }
  }

  private handleFailover(): Promise<void> {
    if (this.failoverPromise) return this.failoverPromise;
    this.failoverPromise = this.performFailover().finally(() => {
      this.failoverPromise = null;
    });
    return this.failoverPromise;
  }

  private async performFailover(opts?: {
    skipReassign?: boolean;
    newWorker?: string;
  }): Promise<void> {
    let newWorker = opts?.newWorker;

    try {
      if (!opts?.skipReassign) {
        // Preflight: verify rewrap prerequisites BEFORE mutating contract state.
        if (!this.sessionMgr.canRewrap()) {
          this.setFailoverStatus("rollover_required");
          throw new MissingDisputerKeyError();
        }

        this.setFailoverStatus("reassigning");
        const result = await this.sessionMgr.reassignSession();
        newWorker = result.newWorker;
      }

      if (!newWorker) {
        throw new Error("No new worker address available for key rewrap");
      }

      this.setFailoverStatus("rewrapping");
      await this.sessionMgr.rewrapAndUpdateKey(newWorker);
      this.setFailoverStatus("none");
    } catch (err) {
      if (
        err instanceof MaxReassignmentsError ||
        err instanceof MissingDisputerKeyError
      ) {
        this.setFailoverStatus("rollover_required");
      } else {
        this.setFailoverStatus("failed");
      }
      // Always rethrow — callers (sendMessages, lifecycle handler) must
      // know the failover did not succeed.
      throw err;
    }
  }

  private async handleReconnect(): Promise<void> {
    if (this.sessionMgr.status !== "ready" && !this.failoverPromise) return;
    if (this.failoverPromise) return;
    if (this.sessionMgr.sessionId === null) return;

    try {
      // Tier 1: Dispatcher status (catches awaiting_reassignment)
      const resp = await this.gateway.getSessionStatus(
        this.sessionMgr.sessionId
      );
      if (resp.sessionStatus === "awaiting_reassignment") {
        await this.handleFailover();
        return;
      }

      // Tier 2: On-chain state (catches partial failover / closed)
      if (resp.sessionStatus === "unknown" || resp.sessionStatus === "active") {
        const state = await this.sessionMgr.getOnChainSessionState();
        if (state.status === 1) {
          this.failoverPromise = this.performFailover({
            skipReassign: true,
            newWorker: state.worker,
          }).finally(() => {
            this.failoverPromise = null;
          });
          await this.failoverPromise;
        } else if (state.status === 2) {
          this.sessionMgr.reset();
          this.onSessionStatus?.("idle");
        }
      }
    } catch {
      // Recovery check failed — don't block normal operation.
    }
  }

  /**
   * Creates a ReadableStream that emits AI SDK event stream data as
   * Server-Sent Events (SSE) — the format expected by the AI SDK's
   * parseJsonEventStream / EventSourceParserStream pipeline.
   */
  private createResponseStream(
    jobId: number,
    chatId: string,
    signal?: AbortSignal
  ): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    const sessionMgr = this.sessionMgr;
    const relayClient = this.relayClient;
    const partId = `text-${jobId}`;
    const assistantMessageId = crypto.randomUUID();
    let started = false;
    let streamedText = "";
    let suppressRetryChunks = false;

    const sse = (obj: Record<string, unknown>): Uint8Array =>
      encoder.encode(`data: ${JSON.stringify(obj)}\n\n`);

    return new ReadableStream<Uint8Array>({
      start: (controller) => {
        if (!relayClient) {
          controller.error(new Error("Relay client not connected"));
          return;
        }

        const unsubscribe = relayClient.onJob(
          jobId,
          async (frame: WSFrame | WSErrorFrame) => {
            try {
              if (frame.type === "error") {
                const errorFrame = frame as WSErrorFrame;
                if (
                  errorFrame.code === "RATE_LIMITED" &&
                  errorFrame.droppedSeq > 0
                ) {
                  return;
                }
                controller.enqueue(
                  sse({ type: "error", errorText: errorFrame.message })
                );
                controller.close();
                unsubscribe();
                return;
              }

              const wsFrame = frame as WSFrame;

              if (wsFrame.type === "metadata") {
                if (wsFrame.payload) {
                  const decrypted = await sessionMgr.decryptResponse(
                    wsFrame.payload
                  );
                  const sources = parseWebSearchSources(decrypted);
                  if (sources.length > 0) {
                    relayClient.setAssistantSources(jobId, sources);
                    controller.enqueue(
                      sse({
                        type: "data-webSearchSources",
                        id: `protocol-web-search-${jobId}`,
                        data: { sources },
                      })
                    );
                  }
                }
                return;
              }

              if (wsFrame.payload && !started) {
                started = true;
                relayClient.beginAssistantMessage({
                  jobId,
                  chatId,
                  messageId: assistantMessageId,
                  protocolMeta: {
                    jobId: wsFrame.jobId,
                    sessionId: wsFrame.sessionId,
                    correlationId: wsFrame.correlationId,
                    completedAt: new Date().toISOString(),
                  },
                });
                controller.enqueue(sse({ type: "text-start", id: partId }));
              }

              if (wsFrame.payload) {
                const decrypted = await sessionMgr.decryptResponse(
                  wsFrame.payload
                );
                if (wsFrame.type === "complete") {
                  relayClient.replaceAssistantText(jobId, decrypted);
                  if (!streamedText) {
                    streamedText = decrypted;
                    controller.enqueue(
                      sse({ type: "text-delta", id: partId, delta: decrypted })
                    );
                  } else if (decrypted.startsWith(streamedText)) {
                    const suffix = decrypted.slice(streamedText.length);
                    if (suffix) {
                      streamedText = decrypted;
                      controller.enqueue(
                        sse({ type: "text-delta", id: partId, delta: suffix })
                      );
                    }
                  }
                  controller.enqueue(
                    sse({
                      type: "data-protocolFinal",
                      id: `protocol-final-${jobId}`,
                      data: { text: decrypted },
                    })
                  );
                } else {
                  if (wsFrame.seq === 1 && streamedText.length > 0) {
                    streamedText = "";
                    relayClient.resetAssistantText(jobId);
                    suppressRetryChunks = true;
                  }
                  streamedText += decrypted;
                  relayClient.appendAssistantDelta(jobId, decrypted);
                  if (!suppressRetryChunks) {
                    controller.enqueue(
                      sse({ type: "text-delta", id: partId, delta: decrypted })
                    );
                  }
                }
              }

              if (wsFrame.type === "complete") {
                if (started) {
                  controller.enqueue(sse({ type: "text-end", id: partId }));
                  await relayClient.completeAssistantMessage(jobId);
                }
                controller.close();
                unsubscribe();
              }
            } catch (err) {
              const msg =
                err instanceof Error ? err.message : "decryption failed";
              controller.enqueue(sse({ type: "error", errorText: msg }));
              relayClient.discardAssistantMessage(jobId);
              controller.close();
              unsubscribe();
            }
          }
        );

        signal?.addEventListener("abort", () => {
          relayClient.discardAssistantMessage(jobId);
          unsubscribe();
          controller.close();
        });
      },
    });
  }
}

function parseWebSearchSources(payload: string): ProtocolCitationSource[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch (err) {
    console.warn("Failed to parse protocol web-search metadata", err);
    return [];
  }
  if (!isRecord(parsed) || parsed.type !== "webSearchSources") {
    console.warn("Unexpected protocol metadata payload", parsed);
    return [];
  }
  if (!Array.isArray(parsed.sources)) {
    console.warn("Protocol web-search metadata missing sources array", parsed);
    return [];
  }

  return parsed.sources.flatMap((source) => {
    if (!isRecord(source)) return [];
    const position =
      typeof source.position === "number" ? source.position : undefined;
    const title = typeof source.title === "string" ? source.title : "";
    const url = typeof source.url === "string" ? source.url : "";
    const snippet = typeof source.snippet === "string" ? source.snippet : "";
    if (!position || !url) return [];
    return [
      {
        position,
        title: title || url,
        url,
        description: snippet,
      },
    ];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getChatId(body?: Record<string, unknown>): string | null {
  if (!body) return null;
  const value = body.id;
  return typeof value === "string" && value.length > 0 ? value : null;
}

function extractTextFromMessage(message: {
  role: string;
  parts?: Array<{ type: string; text?: string }>;
}): string | null {
  if (!message.parts) return null;
  const textParts = message.parts
    .filter((p) => p.type === "text" && p.text)
    .map((p) => p.text);
  return textParts.join("\n") || null;
}
