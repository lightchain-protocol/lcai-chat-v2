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

import type { ProtocolLoadingStatus } from "../types";
import type { GatewayClient } from "./gateway-client";
import type { LifecycleEvent, WSErrorFrame, WSFrame } from "./relay-client";
import { RelayClient } from "./relay-client";
import type { OnChainJob, SessionManagerConfig } from "./session";
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

export type JobStatus =
  | "submitted"
  | "streaming"
  | "completed"
  | "timed_out"
  | "claimed"
  | "disputed";

export type TrackedJob = {
  jobId: number;
  sessionId: number;
  chatId: string;
  /** Unix seconds — from on-chain Job.deadline */
  deadline: number;
  /** Unix seconds — from on-chain Job.completedAt (0 if not yet completed) */
  completedAt: number;
  /** Wei — from on-chain Job.escrowedFee */
  escrowedFee: bigint;
  startedAt: number;
  status: JobStatus;
};

type ProtocolTransportConfig = SessionManagerConfig & {
  persistence: {
    persistUserMessage: (args: {
      chatId: string;
      sessionId: number | null;
      jobId: number | null;
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
  private onProgressStatusChange?: (status: ProtocolLoadingStatus) => void;
  private failoverPromise: Promise<void> | null = null;
  // ── Per-job timeout tracking ─────────────────────────────────────────────
  private readonly activeJobs = new Map<number, TrackedJob>();
  private readonly jobTimers = new Map<number, ReturnType<typeof setTimeout>>();
  private onJobUpdateCallback?: (job: TrackedJob) => void;
  private onJobTimeoutCallback?: (job: TrackedJob) => void;

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

  setOnProgressStatus(cb: (status: ProtocolLoadingStatus) => void) {
    this.onProgressStatusChange = cb;
  }

  setOnJobUpdate(cb: (job: TrackedJob) => void) {
    this.onJobUpdateCallback = cb;
  }

  setOnJobTimeout(cb: (job: TrackedJob) => void) {
    this.onJobTimeoutCallback = cb;
  }

  get sessionStatus() {
    return this.sessionMgr.status;
  }

  /** Returns a snapshot of all tracked jobs (across all chats). */
  listJobs(): TrackedJob[] {
    return [...this.activeJobs.values()];
  }

  /** Claims a timed-out job fee. Wallet signature required. */
  async claimJobTimeout(jobId: number): Promise<{ txHash: string }> {
    const result = await this.sessionMgr.claimJobTimeout(jobId);
    this.updateJobStatus(jobId, "claimed");
    return result;
  }

  /** Files an on-chain dispute for a completed job. Wallet signature required. */
  async disputeJob(jobId: number): Promise<{ txHash: string; bond: bigint }> {
    const result = await this.sessionMgr.disputeJob(jobId);
    this.updateJobStatus(jobId, "disputed");
    return result;
  }

  /** Returns live on-chain job data. */
  async getJob(jobId: number): Promise<OnChainJob> {
    return this.sessionMgr.getJob(jobId);
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
    this.setProgressStatus("idle");
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
    this.setProgressStatus("preparing_chat");

    // Initialize session on first message
    await this.sessionMgr.initialize();
    this.setProgressStatus("thinking");

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

    // Submit job: encrypt → blob upload → on-chain TX via user's wallet
    this.setProgressStatus("submitting_job");
    const { jobId } = await this.sessionMgr.submitJob(plaintext);
    this.setProgressStatus("waiting_for_relay");

    // Track job deadline from chain (fire-and-forget — don't block the stream)
    this.trackJobDeadline(jobId, chatId).catch(() => {
      // Deadline tracking is best-effort; failure must not block response delivery
    });

    // We persist the user message after the job is submitted to ensure the job ID is available for the assistant message.
    await this.persistence.persistUserMessage({
      chatId,
      sessionId: this.sessionMgr.sessionId,
      jobId,
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
    this.setProgressStatus("idle");
    this.clearAllJobTimers();
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
    this.setProgressStatus("idle");
    this.clearAllJobTimers();
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

  private setProgressStatus(status: ProtocolLoadingStatus) {
    this.onProgressStatusChange?.(status);
  }

  private setFailoverStatus(status: FailoverStatus) {
    this.onFailoverStatusChange?.(status);
  }

  // ── Job deadline tracking helpers ─────────────────────────────────────────

  private updateJobStatus(jobId: number, status: JobStatus) {
    const job = this.activeJobs.get(jobId);
    if (!job) return;
    job.status = status;
    this.onJobUpdateCallback?.(job);
  }

  private clearJobTimer(jobId: number) {
    const timer = this.jobTimers.get(jobId);
    if (timer) {
      clearTimeout(timer);
      this.jobTimers.delete(jobId);
    }
  }

  private clearAllJobTimers() {
    for (const timer of this.jobTimers.values()) {
      clearTimeout(timer);
    }
    this.jobTimers.clear();
  }

  /**
   * Fetches the on-chain deadline for jobId, registers a TrackedJob, and
   * schedules a timer that fires 2 s after the deadline.  On expiry, the job
   * state is re-verified — if the worker completed in the same block we clear
   * the timer silently.
   */
  private async trackJobDeadline(jobId: number, chatId: string): Promise<void> {
    let onChain: OnChainJob;
    try {
      onChain = await this.sessionMgr.getJob(jobId);
    } catch {
      return; // Best-effort — can't read chain state
    }

    const tracked: TrackedJob = {
      jobId,
      sessionId: onChain.sessionId,
      chatId,
      deadline: onChain.deadline,
      completedAt: onChain.completedAt,
      escrowedFee: onChain.escrowedFee,
      startedAt: Math.floor(Date.now() / 1_000),
      status: "submitted",
    };
    this.activeJobs.set(jobId, tracked);
    this.onJobUpdateCallback?.(tracked);

    // Delay = (deadline * 1000 - now) + 2000 ms grace
    const delayMs = onChain.deadline * 1_000 - Date.now() + 2_000;
    if (delayMs <= 0) {
      // Already past deadline — fire immediately
      await this.handleJobDeadlineExpiry(jobId);
      return;
    }

    const timer = setTimeout(() => {
      this.handleJobDeadlineExpiry(jobId).catch(() => {
        // Best-effort
      });
    }, delayMs);
    this.jobTimers.set(jobId, timer);
  }

  private async handleJobDeadlineExpiry(jobId: number): Promise<void> {
    this.jobTimers.delete(jobId);

    const tracked = this.activeJobs.get(jobId);
    if (!tracked) return;
    if (tracked.status === "completed" || tracked.status === "claimed" || tracked.status === "disputed") {
      return;
    }

    // Re-check on-chain state — worker may have completed in the same second
    try {
      const onChain = await this.sessionMgr.getJob(jobId);
      // JobState: 0=Submitted 1=Acknowledged 2=Completed 3=TimedOut
      if (onChain.state === 2 || onChain.state === 3) {
        // Worker completed or already timed out — update and don't fire
        tracked.completedAt = onChain.completedAt;
        tracked.status = onChain.state === 2 ? "completed" : "timed_out";
        this.onJobUpdateCallback?.(tracked);
        if (onChain.state === 2) return; // Don't fire timeout for a completed job
      }
    } catch {
      // Chain read failed — fire the timeout optimistically
    }

    tracked.status = "timed_out";
    this.activeJobs.set(jobId, tracked);
    this.onJobUpdateCallback?.(tracked);
    this.onJobTimeoutCallback?.(tracked);
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
                this.setProgressStatus("error");
                controller.enqueue(
                  sse({ type: "error", errorText: errorFrame.message })
                );
                controller.close();
                unsubscribe();
                return;
              }

              const wsFrame = frame as WSFrame;

              if (wsFrame.payload && !started) {
                started = true;
                this.updateJobStatus(jobId, "streaming");
                this.setProgressStatus("decoding_prompt");
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
                this.setProgressStatus("reasoning");
                relayClient.appendAssistantDelta(jobId, decrypted);
                controller.enqueue(
                  sse({ type: "text-delta", id: partId, delta: decrypted })
                );
              }

              if (wsFrame.type === "complete") {
                if (started) {
                  this.setProgressStatus("streaming");
                  controller.enqueue(sse({ type: "text-end", id: partId }));
                  await relayClient.completeAssistantMessage(jobId);
                }
                this.setProgressStatus("completed");
                this.updateJobStatus(jobId, "completed");
                this.clearJobTimer(jobId);
                controller.close();
                unsubscribe();
              }
            } catch (err) {
              const msg =
                err instanceof Error ? err.message : "decryption failed";
              this.setProgressStatus("error");
              controller.enqueue(sse({ type: "error", errorText: msg }));
              relayClient.discardAssistantMessage(jobId);
              controller.close();
              unsubscribe();
            }
          }
        );

        signal?.addEventListener("abort", () => {
          this.setProgressStatus("idle");
          relayClient.discardAssistantMessage(jobId);
          unsubscribe();
          controller.close();
        });
      },
    });
  }
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
