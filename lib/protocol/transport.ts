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

import { withMemoryPrefix } from "../memory";
import type { ProtocolLoadingStatus } from "../types";
import { parseArtifactDescriptor } from "./artifact";
import { base64ToBytes, bytesToBase64 } from "./base64";
import type { GatewayClient } from "./gateway-client";
import { isCompletedJobState } from "./job-state";
import type {
  LifecycleEvent,
  ProtocolCitationSource,
  WSErrorFrame,
  WSFrame,
} from "./relay-client";
import { frameKind, parseGenerationStats, RelayClient } from "./relay-client";
import type { OnChainJob, SessionManagerConfig } from "./session";
import {
  MaxReassignmentsError,
  MissingDisputerKeyError,
  SessionManager,
} from "./session";
import type { SettlementEvent, SettlementProgress } from "./settlement";
import { reduceSettlement } from "./settlement";
import { StreamMetricsTracker } from "./stream-metrics";
import { captureResponseProof, decodeBase64ToBytes } from "./verify-response";

/**
 * Hard ceiling on how long the user-message POST may wait for a jobId before
 * being written without one. Reached when neither the relay nor the submit
 * call ever answers, or — in wallet mode — when the user simply takes longer
 * than this to sign the transaction.
 */
const USER_MESSAGE_PERSIST_DEADLINE_MS = 10_000;

/**
 * How long a stream may wait for its first frame before giving up and saying
 * so. Without this a prompt that is paid for but never answered leaves an
 * assistant bubble that is empty forever, with no error anywhere: `start` is
 * emitted before any token exists, and nothing else is ever emitted.
 *
 * The budget has to clear a cold model comfortably. Measured first-token times
 * on devnet run 6.8s warm to 12.4s for a cold 32B, so this is deliberately far
 * above the worst case - it is a last resort that should only fire when
 * delivery is genuinely broken, never merely because a model was slow.
 */
const FIRST_FRAME_DEADLINE_MS = 180_000;

/** Shown when the relay reports a failure carrying no message of its own. */
const UNSPECIFIED_RELAY_ERROR =
  "The worker reported an error while answering. Please try again.";

/** Shown when a job completes without ever producing any answer text. */
const EMPTY_ANSWER_ERROR =
  "The worker finished without returning an answer. Please try again.";

/** Cap on retained mismatch evidence entries (FIFO eviction past this). */
const MAX_MISMATCH_EVIDENCE = 50;

/**
 * Ceiling on how long a one-off speech-synthesis job may wait for its answer.
 * Piper is fast, but the job still has to bind a worker and settle on-chain, so
 * this mirrors the generous first-frame budget rather than a tight audio one —
 * it exists only so a genuinely broken job can't leave the button spinning.
 */
const SPEECH_SYNTHESIS_DEADLINE_MS = 180_000;

/**
 * How long a one-off speech job waits for its relay socket to finish the
 * authenticated handshake before giving up. The relay registers a connection
 * for a session only once its per-session token authenticates on WS open, and
 * it routes a worker's response to that session solely by the connections it
 * has registered — a frame published before the socket is live is dropped, not
 * queued. The normal chat path is masked from this by wallet-signature and
 * blob-upload latency; a fast delegated TTS submit is not, so this job must
 * wait for the socket to be genuinely connected before it submits.
 */
const RELAY_CONNECT_DEADLINE_MS = 20_000;

/**
 * A response stream whose relay subscription is wired up independently of the
 * submit call, so frames can be consumed before a jobId exists.
 */
type ProtocolStream = {
  stream: ReadableStream<Uint8Array>;
  /** Subscribe by session, before the jobId is known. Idempotent. */
  subscribePending: () => void;
  /** Report the submit result; jobId is null when the API omits it. */
  onSubmitted: (jobId: number | null) => void;
  /** Report a failed submit. Ignored once frames have started arriving. */
  onSubmitFailed: (error: unknown) => void;
  /**
   * Fold the deadline-tracking chain read (worker, escrow, ack state) into the
   * settlement timeline. May arrive after frames have started; the reducer is
   * order-tolerant. No-op once the stream is closed.
   */
  noteChainObservation: (obs: {
    worker: string;
    escrowedFee: bigint;
    deadline: number;
    acknowledged: boolean;
  }) => void;
};

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
  /**
   * The worker that was assigned this job, from on-chain Job.worker.
   *
   * Read from the chain rather than taken on trust from the relay: this is
   * the address the answer is attributed to, so it has to come from the same
   * place the payment did.
   */
  worker: string;
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
  /**
   * Device-local private memory (lib/memory.ts). Called once per send at
   * envelope assembly — AFTER the user-message persist has captured the
   * unmodified message — so memory rides only inside the encrypted envelope
   * and never lands in the chat database.
   */
  getMemoryPrefix?: () => string;
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
  private readonly getMemoryPrefix?: ProtocolTransportConfig["getMemoryPrefix"];
  /** Dedupes Consumer API PUTs for the same on-chain session id. */
  private lastRegisteredApiSessionId: number | null = null;
  private onSessionStatus?: (status: string) => void;
  private onFailoverStatusChange?: (status: FailoverStatus) => void;
  private onProgressStatusChange?: (status: ProtocolLoadingStatus) => void;
  private failoverPromise: Promise<void> | null = null;
  // ── Per-job timeout tracking ─────────────────────────────────────────────
  private readonly jobRegistryAddress: `0x${string}`;
  private readonly chainId: number;
  private readonly activeJobs = new Map<number, TrackedJob>();
  private readonly jobTimers = new Map<number, ReturnType<typeof setTimeout>>();
  /**
   * Streams still waiting on an answer. `release()` runs on unmount, and
   * tearing the relay down there used to orphan an in-flight prompt: the job
   * was paid for and the worker answered seconds later into a socket nobody
   * was holding, so the answer was lost and the bubble stayed empty. While
   * this is non-zero the teardown is deferred, which also lets the assistant
   * message finish persisting so it is there on the next visit.
   */
  private inFlightStreams = 0;
  private releaseWhenIdle = false;
  private onJobUpdateCallback?: (job: TrackedJob) => void;
  private onJobTimeoutCallback?: (job: TrackedJob) => void;
  /**
   * Terminal-frame ciphertext + worker signature, kept in memory per job.
   * `disputeResponseMismatch` needs the full ciphertext as calldata and the
   * persisted proof deliberately omits it (it would double message storage),
   * so the cryptographic dispute is filable only within the live page session
   * that received the answer. Bounded FIFO; entries are small (response text
   * + 28 bytes of AEAD framing).
   */
  private readonly mismatchEvidence = new Map<
    number,
    { ciphertext: Uint8Array; signature: `0x${string}` }
  >();

  constructor(config: ProtocolTransportConfig) {
    const {
      persistence,
      registerProtocolSession,
      getMemoryPrefix,
      ...sessionConfig
    } = config;
    this.sessionMgr = new SessionManager(sessionConfig);
    this.gateway = sessionConfig.gateway;
    this.persistence = persistence;
    this.registerProtocolSession = registerProtocolSession;
    this.getMemoryPrefix = getMemoryPrefix;
    this.jobRegistryAddress = sessionConfig.jobRegistryAddress;
    // The signature the worker produces is domain-separated by chain id, so
    // recovering the signer needs the same value the worker signed with.
    this.chainId = sessionConfig.publicClient.chain?.id ?? 0;
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

  /** True while the live-session evidence for a cryptographic dispute exists. */
  hasMismatchEvidence(jobId: number): boolean {
    return this.mismatchEvidence.has(jobId);
  }

  /**
   * Share evidence for one job: the terminal-frame ciphertext (base64) and
   * worker signature, from the same live-session store as the cryptographic
   * dispute. Null after reload or once the bounded FIFO evicted the entry —
   * shares created then verify as "missing evidence" rather than failing.
   */
  getShareEvidence(
    jobId: number
  ): { ciphertext: string; signature: string } | null {
    const evidence = this.mismatchEvidence.get(jobId);
    if (!evidence) return null;
    return {
      ciphertext: bytesToBase64(evidence.ciphertext),
      signature: evidence.signature,
    };
  }

  /**
   * Files disputeResponseMismatch with the ciphertext + signature captured
   * from the terminal frame. Only possible within the live page session —
   * the ciphertext is never persisted, so after a reload this throws and the
   * UI should steer the user to the bond dispute instead.
   */
  async disputeResponseMismatch(jobId: number): Promise<{ txHash: string }> {
    const evidence = this.mismatchEvidence.get(jobId);
    if (!evidence) {
      throw new Error(
        "Cryptographic dispute evidence is only kept for the live session that received the answer; it was not persisted. Use a bond dispute instead."
      );
    }
    const result = await this.sessionMgr.disputeResponseMismatch({
      jobId,
      ciphertext: evidence.ciphertext,
      signature: evidence.signature,
    });
    this.updateJobStatus(jobId, "disputed");
    return result;
  }

  /** Returns live on-chain job data. */
  getJob(jobId: number): Promise<OnChainJob> {
    return this.sessionMgr.getJob(jobId);
  }

  /** Returns the stake bonded behind a worker, in wei. */
  getWorkerStake(worker: string): Promise<bigint> {
    return this.sessionMgr.getWorkerStake(worker);
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
    this.setProgressStatus("idle");
    // Explicit user action, so the teardown is immediate rather than deferred.
    // Clearing the flag stops a still-running stream from later tripping a
    // release that is no longer wanted.
    this.releaseWhenIdle = false;
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
    // Initialize session on first message. enableWebSearch in the body
    // doubles as the signal to request a search-capable worker at
    // session-create time — once the session is bound, the toggle gates
    // the per-message side-channel (web-search epic, Story 16).
    const enableWebSearch = options.body?.enableWebSearch === true;
    await this.sessionMgr.initialize(
      enableWebSearch ? { requiredCapabilities: ["search"] } : undefined
    );
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

    const sessionId = this.sessionMgr.sessionId;
    if (sessionId === null) {
      throw new Error("Session ID not available after initialization");
    }
    const relayClient = this.relayClient;
    if (!relayClient) {
      throw new Error("Relay client not connected");
    }

    // ORDER MATTERS: subscribe first, submit second.
    //
    // The relay subscribes this socket by session (session:{id}:responses), so
    // the worker's chunks for a brand-new job land on the already-open
    // connection as soon as they exist — which can be before the submit call
    // returns and, now that consumer-api replies at broadcast, before any
    // jobId exists on the client. RelayClient drops frames with no subscriber
    // rather than queueing them, so subscribing after submit would throw away
    // exactly the chunks this change exists to deliver.
    //
    // The one case that cannot be served early: a previous prompt on this
    // session has a pending handler that has not bound yet. Two unbound
    // handlers cannot be told apart by the first frame, so rather than guess
    // we fall back to the legacy "submit, then subscribe by jobId" order for
    // this message only. See RelayClient.onPendingJob for the guarantees.
    const canBindOnFirstFrame = !relayClient.hasUnboundPendingJob(sessionId);

    // Persisting the user message is deferred, not awaited: the POST is the
    // only place the jobId is still wanted synchronously, and blocking on it
    // would re-introduce the stall we are removing. See deferUserMessagePersist.
    //
    // Regenerating re-sends the same user message id; POSTing it again would
    // collide with the row already written by the original send (API 500,
    // swallowed) and, after a reload, show two answers under one prompt. The
    // rest of the regenerate path — new job, new assistant message — is
    // unaffected: only the user-message persist is skipped.
    const persist =
      options.body?.trigger === "regenerate-message"
        ? {
            settle: () => {
              // no-op: nothing was ever queued to persist.
            },
            cancel: () => {
              // no-op: nothing was ever queued to persist.
            },
            done: Promise.resolve(),
          }
        : this.deferUserMessagePersist({
            chatId,
            sessionId,
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

    // The chat row is created by the user-message POST, so the session
    // registration and the assistant POST both have to queue behind it.
    const prelude = persist.done.then(() =>
      this.registerProtocolSessionWithServerIfNeeded(chatId).catch((err) => {
        console.warn("Failed to register protocol session", err);
      })
    );

    const protocolStream = this.createResponseStream({
      sessionId,
      chatId,
      prelude,
      signal: options.signal,
      friendlyModelId:
        typeof options.body?.friendlyModelId === "string"
          ? options.body.friendlyModelId
          : undefined,
      onJobIdResolved: (jobId) => {
        persist.settle(jobId);
        // Deadline tracking is best-effort; failure must not block delivery.
        // The same read feeds the settlement timeline's escrow/ack evidence.
        this.trackJobDeadline(jobId, chatId)
          .then((obs) => {
            if (obs) protocolStream.noteChainObservation(obs);
          })
          .catch(() => {
            // Best-effort — see trackJobDeadline.
          });
      },
      onTerminated: (jobId) => persist.settle(jobId),
    });

    // Submit job: encrypt → blob upload → on-chain TX via user's wallet.
    // searchEnabled rides through SessionManager.submitJob into the gateway
    // blob upload, which writes the side-channel the dispatcher reads.
    this.setProgressStatus("submitting_job");
    try {
      if (canBindOnFirstFrame) {
        protocolStream.subscribePending();
      }
    } catch (err) {
      // Nothing was submitted, so drop the queued persist rather than writing
      // an orphan user message for a prompt that never left the client.
      persist.cancel();
      // Closes the stream nobody will read, which also releases the in-flight
      // count it took when it was created.
      protocolStream.onSubmitFailed(err);
      throw err;
    }

    // Deliberately not awaited — the stream must be able to emit its first
    // token before this resolves. Both outcomes are routed into the stream.
    //
    // Private memory folds in here — envelope assembly, after the deferred
    // persist above already captured the unmodified user message — so the
    // prefix exists only inside the encrypted blob, never in chat history.
    // Search stays worker-side: searchEnabled rides the sentinel envelope
    // that pkg/searchaug decodes.
    // The user may have pressed Stop while the session was still being
    // claimed. Nothing is on chain yet at this point, so bail before the
    // job is submitted and paid for; useChat treats the AbortError as a
    // plain cancel.
    if (options.signal?.aborted) {
      const cancelled = new DOMException(
        "Send cancelled before job submission",
        "AbortError"
      );
      persist.cancel();
      protocolStream.onSubmitFailed(cancelled);
      throw cancelled;
    }
    const prompt = withMemoryPrefix(this.getMemoryPrefix?.() ?? "", plaintext);
    this.sessionMgr
      .submitJob(prompt, { searchEnabled: enableWebSearch })
      .then((result) =>
        protocolStream.onSubmitted(normalizeJobId(result.jobId))
      )
      .catch((err) => protocolStream.onSubmitFailed(err));

    return {
      response: new Response(protocolStream.stream, {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          // The AI SDK identifies a UI message stream by this header. Without
          // it the response is not parsed as one, every chunk arrives as an
          // empty object, and useChat rejects the lot against its chunk union
          // while the tokens themselves are perfectly fine.
          "x-vercel-ai-ui-message-stream": "v1",
        },
      }),
    };
  }

  /**
   * One-off text-to-speech job. Submits `text` as an ordinary protocol job on
   * this transport's model — a TTS model (tts-piper) returns base64-encoded MP3
   * bytes as its response payload instead of text — waits for the settled
   * answer, and returns the decoded MP3 bytes.
   *
   * Deliberately does NOT go through sendMessages(): that pipeline persists a
   * user message and an assistant message to the chat database and drives the
   * useChat stream. Read-aloud must leave no trace in the visible thread, so
   * this drives the same session/submit/decrypt machinery directly and simply
   * collects the response. The job is still a real, paid, on-chain job that
   * settles and is verifiable like any other.
   */
  async synthesizeSpeech(
    text: string,
    opts?: { signal?: AbortSignal }
  ): Promise<Uint8Array> {
    const plaintext = text.trim();
    if (!plaintext) {
      throw new Error("No text to synthesize");
    }

    this.setProgressStatus("preparing_chat");
    await this.sessionMgr.initialize();
    this.ensureRelayConnected();

    if (this.sessionMgr.status !== "ready") {
      throw new Error("Session is not ready — cannot synthesize speech");
    }
    const sessionId = this.sessionMgr.sessionId;
    if (sessionId === null) {
      throw new Error("Session ID not available after initialization");
    }
    const relayClient = this.relayClient;
    if (!relayClient) {
      throw new Error("Relay client not connected");
    }

    // Wait for the socket to actually finish its authenticated handshake before
    // submitting. Until the relay has registered this session's connection it
    // has nowhere to route the worker's response and drops it — the root cause
    // of the button spinning while the job settled fine server-side.
    this.setProgressStatus("waiting_for_relay");
    await this.waitForRelayConnected(relayClient, { signal: opts?.signal });

    return await new Promise<Uint8Array>((resolve, reject) => {
      let settled = false;
      let unsubscribe: (() => void) | null = null;
      let streamed = "";
      let timeout: ReturnType<typeof setTimeout> | null = null;

      const onAbort = () => {
        finish(
          undefined,
          new DOMException("Speech synthesis cancelled", "AbortError")
        );
      };

      function cleanup() {
        if (timeout) {
          clearTimeout(timeout);
          timeout = null;
        }
        unsubscribe?.();
        unsubscribe = null;
        opts?.signal?.removeEventListener("abort", onAbort);
      }

      function finish(bytes?: Uint8Array, err?: unknown) {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        if (err !== undefined) {
          reject(err instanceof Error ? err : new Error(String(err)));
        } else if (bytes) {
          resolve(bytes);
        } else {
          reject(new Error("Speech synthesis produced no audio"));
        }
      }

      const decode = (base64: string) => {
        const trimmed = base64.trim();
        if (!trimmed) {
          finish(undefined, new Error("The worker returned no audio"));
          return;
        }
        try {
          finish(base64ToBytes(trimmed));
        } catch (err) {
          finish(undefined, err);
        }
      };

      // Serialize frame handling: decryptResponse is async, so without an
      // await-chain a quickly-decrypted frame could overtake an earlier one.
      let chain: Promise<void> = Promise.resolve();
      const handleFrame = (frame: WSFrame | WSErrorFrame) => {
        chain = chain.then(async () => {
          if (settled) {
            return;
          }
          if (frame.type === "error") {
            const errorFrame = frame as WSErrorFrame;
            if (
              errorFrame.code === "RATE_LIMITED" &&
              errorFrame.droppedSeq > 0
            ) {
              return;
            }
            finish(
              undefined,
              new Error(errorFrame.message || UNSPECIFIED_RELAY_ERROR)
            );
            return;
          }
          const wsFrame = frame as WSFrame;
          // Metadata frames (e.g. web-search sources) never carry audio.
          if (wsFrame.type === "metadata" || !wsFrame.payload) {
            if (wsFrame.type === "complete") {
              decode(streamed);
            }
            return;
          }
          const decrypted = await this.sessionMgr.decryptResponse(
            wsFrame.payload
          );
          // The terminal `complete` frame carries the full, authoritative
          // answer (the base64 MP3). Chunk frames, if any, are accumulated as
          // a fallback for a worker that only streams.
          if (wsFrame.type === "complete") {
            decode(decrypted || streamed);
          } else {
            streamed += decrypted;
          }
        });
        chain.catch((err) => finish(undefined, err));
      };

      if (opts?.signal) {
        if (opts.signal.aborted) {
          finish(
            undefined,
            new DOMException("Speech synthesis cancelled", "AbortError")
          );
          return;
        }
        opts.signal.addEventListener("abort", onAbort);
      }

      timeout = setTimeout(
        () => finish(undefined, new Error("Timed out waiting for speech")),
        SPEECH_SYNTHESIS_DEADLINE_MS
      );

      // ORDER MATTERS: subscribe by session first, submit second — the same
      // guarantee sendMessages() relies on, so a worker that answers before the
      // submit call returns doesn't lose its frames. A dedicated TTS transport
      // is used serially, so an unbound pending handler should never exist; if
      // one somehow does, bail rather than orphan its frames.
      if (relayClient.hasUnboundPendingJob(sessionId)) {
        finish(
          undefined,
          new Error("Another synthesis is already in flight on this session")
        );
        return;
      }
      try {
        unsubscribe = relayClient.onPendingJob(sessionId, handleFrame);
      } catch (err) {
        finish(undefined, err);
        return;
      }

      this.setProgressStatus("submitting_job");
      this.sessionMgr
        .submitJob(plaintext)
        .then((result) => {
          const jobId = normalizeJobId(result.jobId);
          // Converge the pending handler onto the authoritative jobId when
          // wallet-mode submit returns one; delegated mode binds on first frame.
          if (jobId !== null) {
            relayClient.bindPendingJob(sessionId, jobId);
          }
        })
        .catch((err) => finish(undefined, err));
    });
  }

  /**
   * Schedules the user-message POST without blocking the stream.
   *
   * `settle` fires the POST exactly once with the best jobId known at that
   * moment; every subsequent call is a no-op. It is invoked from every path
   * that can end the send — first relay frame, submit success, submit failure,
   * stream completion, stream error, abort — plus a wall-clock deadline, so
   * there is no code path on which the POST is simply never issued. A failing
   * POST is logged rather than rethrown: the job is already on-chain and the
   * stream must survive a persistence hiccup.
   */
  private deferUserMessagePersist(args: {
    chatId: string;
    sessionId: number;
    message: { role: string; parts?: Array<{ type: string; text?: string }> };
    selectedVisibilityType?: string;
    systemPrompt?: string | null;
  }): {
    settle: (jobId: number | null) => void;
    cancel: () => void;
    done: Promise<void>;
  } {
    let settled = false;
    let markDone!: () => void;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const done = new Promise<void>((resolve) => {
      markDone = resolve;
    });

    const settle = (jobId: number | null) => {
      if (settled) return;
      settled = true;
      if (deadline !== undefined) clearTimeout(deadline);
      try {
        this.persistence
          .persistUserMessage({ ...args, jobId })
          .catch((err) => {
            console.warn("Failed to persist protocol user message", err);
          })
          .finally(() => markDone());
      } catch (err) {
        console.warn("Failed to persist protocol user message", err);
        markDone();
      }
    };

    /** Abandons the persist — only valid before the prompt is submitted. */
    const cancel = () => {
      if (settled) return;
      settled = true;
      if (deadline !== undefined) clearTimeout(deadline);
      markDone();
    };

    // Last-resort trigger: if neither a frame nor a submit result ever arrives
    // we still persist the prompt rather than losing it, jobId or not.
    deadline = setTimeout(() => settle(null), USER_MESSAGE_PERSIST_DEADLINE_MS);

    return { settle, cancel, done };
  }

  /**
   * Disconnects relay and clears in-memory session state without removing
   * sessionStorage — use when switching chats or unmounting the composer.
   */
  release() {
    // An answer is still on its way. Dropping the socket now would lose it for
    // a prompt the user has already paid for, so let the stream finish and tear
    // down in its close handler instead. Every stream is bounded by the
    // no-answer watchdog, so this cannot keep a connection open indefinitely.
    if (this.inFlightStreams > 0) {
      this.releaseWhenIdle = true;
      return;
    }
    this.releaseNow();
  }

  private releaseNow() {
    this.releaseWhenIdle = false;
    this.relayClient?.disconnect();
    this.relayClient = null;
    this.lastRegisteredApiSessionId = null;
    this.failoverPromise = null;
    this.setFailoverStatus("none");
    this.setProgressStatus("idle");
    this.clearAllJobTimers();
    this.mismatchEvidence.clear();
    this.sessionMgr.release();
  }

  private streamOpened() {
    this.inFlightStreams++;
  }

  private streamClosed() {
    this.inFlightStreams = Math.max(0, this.inFlightStreams - 1);
    if (this.inFlightStreams === 0 && this.releaseWhenIdle) {
      this.releaseNow();
    }
  }

  /**
   * Disconnects relay and clears persisted protocol state (wallet disconnect).
   */
  destroy() {
    this.releaseWhenIdle = false;
    this.relayClient?.disconnect();
    this.relayClient = null;
    this.lastRegisteredApiSessionId = null;
    this.failoverPromise = null;
    this.setFailoverStatus("none");
    this.setProgressStatus("idle");
    this.clearAllJobTimers();
    this.mismatchEvidence.clear();
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

  /**
   * Resolves once the relay socket has reached "connected" — i.e. the WS
   * handshake completed and the per-session token authenticated, at which point
   * the relay has registered a connection for this session and will route its
   * responses. `connect()` only *starts* the handshake, so callers that submit
   * immediately (a fast delegated job) must await this first or race the
   * worker's publish. A transient mid-handshake close is tolerated — the client
   * auto-reconnects, so this keeps waiting until the deadline rather than
   * failing on a blip.
   */
  private waitForRelayConnected(
    relayClient: RelayClient,
    opts?: { signal?: AbortSignal; timeoutMs?: number }
  ): Promise<void> {
    if (relayClient.getStatus() === "connected") {
      return Promise.resolve();
    }
    const deadline =
      Date.now() + (opts?.timeoutMs ?? RELAY_CONNECT_DEADLINE_MS);
    return new Promise<void>((resolve, reject) => {
      const check = () => {
        if (opts?.signal?.aborted) {
          reject(new DOMException("Speech synthesis cancelled", "AbortError"));
          return;
        }
        if (relayClient.getStatus() === "connected") {
          resolve();
          return;
        }
        if (Date.now() > deadline) {
          reject(new Error("Timed out connecting to the relay"));
          return;
        }
        setTimeout(check, 50);
      };
      setTimeout(check, 50);
    });
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
   *
   * Returns the chain observation (worker, escrow, deadline, ack state) so the
   * response stream can fold it into the settlement timeline; null when the
   * read failed, which must never block delivery.
   */
  private async trackJobDeadline(
    jobId: number,
    chatId: string
  ): Promise<{
    worker: string;
    escrowedFee: bigint;
    deadline: number;
    acknowledged: boolean;
  } | null> {
    let onChain: OnChainJob;
    try {
      onChain = await this.sessionMgr.getJob(jobId);
    } catch {
      return null; // Best-effort — can't read chain state
    }

    const tracked: TrackedJob = {
      jobId,
      sessionId: onChain.sessionId,
      chatId,
      worker: onChain.worker,
      deadline: onChain.deadline,
      completedAt: onChain.completedAt,
      escrowedFee: onChain.escrowedFee,
      startedAt: Math.floor(Date.now() / 1000),
      status: "submitted",
    };
    this.activeJobs.set(jobId, tracked);
    this.onJobUpdateCallback?.(tracked);

    // Delay = (deadline * 1000 - now) + 2000 ms grace
    const delayMs = onChain.deadline * 1000 - Date.now() + 2000;
    if (delayMs <= 0) {
      // Already past deadline — fire immediately
      await this.handleJobDeadlineExpiry(jobId);
    } else {
      const timer = setTimeout(() => {
        this.handleJobDeadlineExpiry(jobId).catch(() => {
          // Best-effort
        });
      }, delayMs);
      this.jobTimers.set(jobId, timer);
    }

    // JobState: 0=Submitted 1=Acknowledged 2=Completed 3=TimedOut
    return {
      worker: onChain.worker,
      escrowedFee: onChain.escrowedFee,
      deadline: onChain.deadline,
      acknowledged: onChain.state >= 1,
    };
  }

  private async handleJobDeadlineExpiry(jobId: number): Promise<void> {
    this.jobTimers.delete(jobId);

    const tracked = this.activeJobs.get(jobId);
    if (!tracked) return;
    if (
      tracked.status === "completed" ||
      tracked.status === "claimed" ||
      tracked.status === "disputed"
    ) {
      return;
    }

    // Re-check on-chain state — worker may have completed in the same second
    try {
      const onChain = await this.sessionMgr.getJob(jobId);
      // Completed (2) and its post-completion terminal states (Resolved=5,
      // Released=6) all mean the worker delivered; only TimedOut (3) is a
      // genuine timeout. An exact ===2 misreads keeper-released jobs.
      if (isCompletedJobState(onChain.state) || onChain.state === 3) {
        // Worker completed or already timed out — update and don't fire
        tracked.completedAt = onChain.completedAt;
        tracked.status = isCompletedJobState(onChain.state)
          ? "completed"
          : "timed_out";
        this.onJobUpdateCallback?.(tracked);
        if (isCompletedJobState(onChain.state)) return; // Don't fire timeout for a completed job
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
   * Derives and publishes the verification evidence for a settled response.
   *
   * Never rejects: a missing proof costs the verification badge, and an answer
   * the user already has on screen must not be disturbed by it.
   */
  private async captureProof(args: {
    jobId: number;
    sessionId: number;
    payload: string;
    signature: string;
    relayClient: RelayClient | null;
    emit: (obj: Record<string, unknown>) => void;
  }): Promise<void> {
    try {
      const ciphertext = decodeBase64ToBytes(args.payload);
      const proof = await captureResponseProof({
        chainId: this.chainId,
        jobRegistryAddress: this.jobRegistryAddress,
        jobId: args.jobId,
        sessionId: args.sessionId,
        ciphertext,
        signature: (args.signature || null) as `0x${string}` | null,
      });
      // Keep the dispute evidence for the live session. The persisted proof
      // carries only the hash + signature + digest; disputeResponseMismatch
      // needs the bytes themselves, and this is the only place they exist.
      if (proof.signature && proof.signedDigest) {
        this.mismatchEvidence.set(args.jobId, {
          ciphertext,
          signature: proof.signature,
        });
        if (this.mismatchEvidence.size > MAX_MISMATCH_EVIDENCE) {
          const oldest = this.mismatchEvidence.keys().next().value;
          if (oldest !== undefined) this.mismatchEvidence.delete(oldest);
        }
      }
      args.relayClient?.setAssistantProof(args.jobId, proof);
      args.emit({
        type: "data-responseProof",
        id: `protocol-proof-${args.jobId}`,
        data: proof,
      });
    } catch {
      // Intentionally swallowed - see the doc comment.
    }
  }

  /**
   * Creates a ReadableStream that emits AI SDK event stream data as
   * Server-Sent Events (SSE) — the format expected by the AI SDK's
   * parseJsonEventStream / EventSourceParserStream pipeline.
   *
   * The stream is built before the jobId is known. It subscribes either by
   * session (`subscribePending`, the fast path) or by jobId once submit
   * returns one (`onSubmitted`, the fallback path), and the two converge on a
   * single subscription — never two.
   */
  private createResponseStream(args: {
    sessionId: number;
    chatId: string;
    /** Resolves once the user message is stored and the session registered. */
    prelude: Promise<void>;
    signal?: AbortSignal;
    /**
     * Friendly catalogue id of the model this send resolved to
     * (e.g. "agentworld-35b-max") — recorded into the assistant message's
     * protocolMeta so tier labels and transcripts name what served it.
     */
    friendlyModelId?: string;
    /** Fired once, with the first jobId this stream learns about. */
    onJobIdResolved: (jobId: number) => void;
    /** Fired once when the stream ends, with the jobId if one was learned. */
    onTerminated: (jobId: number | null) => void;
  }): ProtocolStream {
    const {
      sessionId,
      chatId,
      prelude,
      signal,
      friendlyModelId,
      onJobIdResolved,
      onTerminated,
    } = args;
    const encoder = new TextEncoder();
    const sessionMgr = this.sessionMgr;
    const relayClient = this.relayClient;
    const assistantMessageId = crypto.randomUUID();
    // Keyed off the assistant message rather than the jobId: the first SSE
    // part id has to be chosen before any jobId exists.
    const partId = `text-${assistantMessageId}`;
    const reasoningPartId = `reasoning-${assistantMessageId}`;
    let boundJobId: number | null = null;
    // started means "a frame of any kind has arrived", which is what clears
    // the waiting placeholder. textStarted is separate because a reasoning
    // model streams thought first, and emitting text-start before any text
    // would open an empty answer part.
    let started = false;
    let textStarted = false;
    let reasoningStarted = false;
    let streamedText = "";
    let suppressRetryChunks = false;
    // Browser-measured timing (TTFT, rolling rate) and the settlement journey.
    // Both emit as reconciled data parts (stable ids, updated in place by the
    // SDK) and are persisted in their final form with the assistant message.
    const metrics = new StreamMetricsTracker(Date.now());
    let settlement: SettlementProgress = { stage: "escrowed" };
    let artifactCount = 0;
    // Awaited before persist, like capturedProof: the post-settle chain re-read
    // that fills in the on-chain completion time.
    let capturedSettlement: Promise<void> = Promise.resolve();
    // Awaited just before the message is persisted, so the proof is attached
    // in time to be stored with it.
    let capturedProof: Promise<void> = Promise.resolve();
    let closed = false;
    let unsubscribe: (() => void) | null = null;
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    let firstFrameTimer: ReturnType<typeof setTimeout> | undefined;
    // Live metrics are emitted at most this often; the final snapshot always
    // goes out with the terminal frame regardless of throttle.
    let lastMetricsEmitMs = 0;
    const METRICS_EMIT_INTERVAL_MS = 500;

    const sse = (obj: Record<string, unknown>): Uint8Array =>
      encoder.encode(`data: ${JSON.stringify(obj)}\n\n`);

    // The consumer may cancel the ReadableStream at any point (useChat abort,
    // component unmount), after which enqueue/close throw. Frames can still be
    // in flight at that moment, so both are best-effort.
    const emit = (obj: Record<string, unknown>) => {
      if (closed) return;
      try {
        controller.enqueue(sse(obj));
      } catch {
        closed = true;
      }
    };

    const applySettlement = (event: SettlementEvent) => {
      settlement = reduceSettlement(settlement, event);
      emit({
        type: "data-settlement",
        id: `protocol-settlement-${assistantMessageId}`,
        data: settlement,
      });
    };

    const noteChainObservation = (obs: {
      worker: string;
      escrowedFee: bigint;
      deadline: number;
      acknowledged: boolean;
    }) => {
      if (closed) return;
      applySettlement({
        type: "chainObserved",
        atMs: Date.now(),
        worker: obs.worker,
        escrowedFeeWei: obs.escrowedFee.toString(),
        deadlineSec: obs.deadline,
        acknowledged: obs.acknowledged,
      });
    };

    const emitMetrics = (force = false) => {
      const nowMs = Date.now();
      if (!force && nowMs - lastMetricsEmitMs < METRICS_EMIT_INTERVAL_MS) {
        return;
      }
      lastMetricsEmitMs = nowMs;
      emit({
        type: "data-streamMetrics",
        id: `protocol-metrics-${assistantMessageId}`,
        data: metrics.snapshot(),
      });
    };

    const close = () => {
      if (closed) return;
      closed = true;
      clearFirstFrameDeadline();
      unsubscribe?.();
      unsubscribe = null;
      try {
        controller.close();
      } catch {
        // Already cancelled by the consumer.
      }
      onTerminated(boundJobId);
      this.streamClosed();
    };

    const clearFirstFrameDeadline = () => {
      if (firstFrameTimer === undefined) return;
      clearTimeout(firstFrameTimer);
      firstFrameTimer = undefined;
    };

    /**
     * Arms the no-answer watchdog. The job is on chain and paid for by this
     * point, so the failure being guarded against is delivery, not payment:
     * either the socket died before the worker published, or the frames went
     * somewhere this stream is not listening. Either way the user must be told
     * rather than left watching an empty bubble.
     */
    const armFirstFrameDeadline = () => {
      if (firstFrameTimer !== undefined || closed) return;
      firstFrameTimer = setTimeout(() => {
        firstFrameTimer = undefined;
        if (closed || started) return;
        const offline = relayClient?.getStatus() !== "connected";
        fail(
          offline
            ? "Lost the connection to the relay before the answer arrived. Your prompt was paid for and may still complete - reload the chat to check."
            : "No answer came back from the worker in time. Your prompt was paid for and may still complete - reload the chat to check."
        );
      }, FIRST_FRAME_DEADLINE_MS);
    };

    const fail = (message: string) => {
      if (closed) return;
      this.setProgressStatus("error");
      applySettlement({
        type: "failed",
        atMs: Date.now(),
        reason: message,
      });
      emit({ type: "error", errorText: message });
      close();
    };

    const resolveJobId = (candidate: number) => {
      const jobId = normalizeJobId(candidate);
      if (jobId === null || boundJobId !== null) return;
      boundJobId = jobId;
      // The jobId existing at all means the escrow landed on chain — this is
      // the timeline's first milestone, whichever path reported the id.
      applySettlement({ type: "escrowed", atMs: Date.now() });
      onJobIdResolved(jobId);
    };

    const handleFrame = async (frame: WSFrame | WSErrorFrame) => {
      // The watchdog is deliberately not cleared here. A metadata frame proves
      // the pipe works but not that an answer is coming, and disarming on it
      // would leave the stream hanging with no deadline at all. It is cleared
      // when the first payload arrives, and by close() on every terminal path.
      resolveJobId(frame.jobId);
      const jobId = boundJobId ?? frame.jobId;
      try {
        if (frame.type === "error") {
          const errorFrame = frame as WSErrorFrame;
          if (errorFrame.code === "RATE_LIMITED" && errorFrame.droppedSeq > 0) {
            return;
          }
          // consumer-api publishes error frames with no `message` field, which
          // would otherwise surface as an error with no text at all.
          fail(errorFrame.message || UNSPECIFIED_RELAY_ERROR);
          return;
        }

        const wsFrame = frame as WSFrame;

        if (wsFrame.type === "metadata") {
          if (wsFrame.payload) {
            const decrypted = await sessionMgr.decryptResponse(wsFrame.payload);
            const sources = parseWebSearchSources(decrypted);
            if (sources.length > 0) {
              relayClient?.setAssistantSources(jobId, sources);
              emit({
                type: "data-webSearchSources",
                id: `protocol-web-search-${jobId}`,
                data: { sources },
              });
            }
          }
          return;
        }

        if (wsFrame.payload && !started) {
          started = true;
          clearFirstFrameDeadline();
          this.updateJobStatus(jobId, "streaming");
          this.setProgressStatus("decoding_prompt");
          metrics.markPayload();
          applySettlement({ type: "firstFrame", atMs: Date.now() });
          emitMetrics(true);
          const protocolMeta = {
            jobId: wsFrame.jobId,
            sessionId: wsFrame.sessionId,
            correlationId: wsFrame.correlationId,
            completedAt: new Date().toISOString(),
            // Friendly catalogue id ("agentworld-35b-max") so tier labels
            // and transcripts can name what served the answer.
            model: friendlyModelId,
          };
          relayClient?.beginAssistantMessage({
            jobId,
            chatId,
            messageId: assistantMessageId,
            protocolMeta,
          });
          // The message row's metadata.protocolMeta only exists after the
          // persist round trip — until then everything keyed off the serving
          // model (Max live progress, tier labels, share tier) would stay
          // dark. This data part carries the same record live, and is
          // persisted alongside the message so the reload view matches.
          emit({
            type: "data-protocolMeta",
            id: `protocol-meta-${jobId}`,
            data: protocolMeta,
          });
        }

        // Non-text channels are demultiplexed here, before the text path.
        // They must not touch streamedText: that string is reconciled against
        // the terminal frame, which carries only the answer.
        const kind = frameKind(wsFrame);
        if (wsFrame.payload && wsFrame.type !== "complete" && kind !== "text") {
          const decrypted = await sessionMgr.decryptResponse(wsFrame.payload);

          if (kind === "reasoning") {
            if (!reasoningStarted) {
              reasoningStarted = true;
              emit({ type: "reasoning-start", id: reasoningPartId });
            }
            this.setProgressStatus("reasoning");
            emit({
              type: "reasoning-delta",
              id: reasoningPartId,
              delta: decrypted,
            });
            return;
          }

          if (kind === "stats") {
            // A malformed stats frame costs the user a throughput badge and
            // nothing else, so it is dropped rather than breaking the answer.
            const stats = parseGenerationStats(decrypted);
            if (stats) {
              relayClient?.setAssistantStats(jobId, stats);
              emit({
                type: "data-generationStats",
                id: `protocol-stats-${jobId}`,
                data: stats,
              });
            }
            return;
          }

          if (kind === "artifact") {
            const descriptor = parseArtifactDescriptor(decrypted);
            if (descriptor) {
              artifactCount += 1;
              relayClient?.addAssistantArtifact(jobId, descriptor);
              emit({
                type: "data-artifact",
                id: `protocol-artifact-${assistantMessageId}-${artifactCount}`,
                data: descriptor,
              });
            }
            // A malformed descriptor is dropped: one missing card, never a
            // broken answer (same best-effort contract as stats frames).
            return;
          }

          // Unknown future kinds are dropped here rather than corrupting the
          // answer text.
          return;
        }

        if (wsFrame.payload && !textStarted) {
          textStarted = true;
          applySettlement({ type: "firstText", atMs: Date.now() });
          emit({ type: "text-start", id: partId });
        }

        if (wsFrame.payload) {
          const decrypted = await sessionMgr.decryptResponse(wsFrame.payload);
          this.setProgressStatus("reasoning");
          if (wsFrame.type === "complete") {
            // Capture the verification evidence while the ciphertext is still
            // in hand. It is never persisted, so this is the only chance to
            // recover the signer and hash the settled bytes. Deliberately not
            // awaited: the answer must render immediately, and losing the
            // proof costs a badge rather than the reply.
            capturedProof = this.captureProof({
              jobId,
              sessionId: wsFrame.sessionId,
              payload: wsFrame.payload,
              signature: wsFrame.signature,
              relayClient,
              emit,
            });
            relayClient?.replaceAssistantText(jobId, decrypted);
            if (streamedText) {
              if (decrypted.startsWith(streamedText)) {
                const suffix = decrypted.slice(streamedText.length);
                if (suffix) {
                  streamedText = decrypted;
                  metrics.addTextChars(suffix.length);
                  emit({ type: "text-delta", id: partId, delta: suffix });
                }
              }
            } else {
              streamedText = decrypted;
              metrics.addTextChars(decrypted.length);
              emit({ type: "text-delta", id: partId, delta: decrypted });
            }
            emit({
              type: "data-protocolFinal",
              id: `protocol-final-${jobId}`,
              data: { text: decrypted },
            });
          } else {
            if (wsFrame.seq === 1 && streamedText.length > 0) {
              streamedText = "";
              relayClient?.resetAssistantText(jobId);
              suppressRetryChunks = true;
            }
            streamedText += decrypted;
            metrics.addTextChars(decrypted.length);
            relayClient?.appendAssistantDelta(jobId, decrypted);
            if (!suppressRetryChunks) {
              emit({ type: "text-delta", id: partId, delta: decrypted });
            }
            emitMetrics();
          }
        }

        if (wsFrame.type === "complete") {
          // A completion carrying no text is a failure, whichever way it got
          // here: either no frame ever had a payload, or every payload
          // decrypted to nothing. Finishing normally would leave a bubble that
          // renders blank, cannot be copied, and cannot be voted on, because
          // completeAssistantMessage drops empty text and never writes a row.
          if (!started || !streamedText.trim()) {
            console.warn("Protocol stream completed with no answer", {
              jobId,
              seq: wsFrame.seq,
              hadPayload: Boolean(wsFrame.payload),
              started,
            });
            if (reasoningStarted) {
              // Close the reasoning part even on the failure path, or the UI
              // is left with a reasoning block that never finishes.
              emit({ type: "reasoning-end", id: reasoningPartId });
            }
            relayClient?.discardAssistantMessage(jobId);
            // The job did settle on chain, so it stays "completed" and keeps
            // its dispute affordance — an answer that was paid for and came
            // back empty is precisely what disputing is for.
            this.updateJobStatus(jobId, "completed");
            this.clearJobTimer(jobId);
            fail(EMPTY_ANSWER_ERROR);
            return;
          }

          this.setProgressStatus("streaming");
          if (reasoningStarted) {
            emit({ type: "reasoning-end", id: reasoningPartId });
          }
          emit({ type: "text-end", id: partId });
          applySettlement({ type: "settled", atMs: Date.now() });
          emitMetrics(true);
          // The terminal frame proves delivery; a best-effort chain re-read
          // fills in the on-chain completion time for the persisted timeline.
          // Awaited below, before the message is stored, exactly like the
          // proof capture — a failed read costs one timestamp, not the answer.
          capturedSettlement = (async () => {
            try {
              const onChain = await sessionMgr.getJob(jobId);
              // Accept Completed and its terminal successors (Resolved,
              // Released) — the keeper can advance the job within seconds on
              // a short devnet dispute window, before this re-read lands.
              if (
                isCompletedJobState(onChain.state) &&
                onChain.completedAt > 0
              ) {
                applySettlement({
                  type: "chainSettled",
                  completedAtSec: onChain.completedAt,
                });
              }
            } catch {
              // Best-effort — see above.
            }
            relayClient?.setAssistantSettlement(jobId, settlement);
            relayClient?.setAssistantMetrics(jobId, metrics.snapshot());
          })();
          // The chat row is created by the user-message POST, so the
          // assistant POST has to wait for it even though nothing else does.
          await prelude;
          // Signature recovery is fast but not instant; waiting here is what
          // gets the proof stored alongside the message rather than arriving
          // after it has already been written.
          await capturedProof;
          await capturedSettlement;
          await relayClient?.completeAssistantMessage(jobId);
          this.setProgressStatus("completed");
          this.updateJobStatus(jobId, "completed");
          this.clearJobTimer(jobId);
          // Close the message before the stream itself, so useChat marks the
          // assistant turn finished rather than leaving it mid-stream.
          emit({ type: "finish", finishReason: "stop" });
          close();
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "decryption failed";
        relayClient?.discardAssistantMessage(jobId);
        fail(msg);
      }
    };

    // Frames are processed one at a time. handleFrame awaits decryption, so
    // without this chain a chunk that decrypts quickly could overtake an
    // earlier one and corrupt the assembled text.
    let frameQueue: Promise<void> = Promise.resolve();
    const enqueueFrame = (frame: WSFrame | WSErrorFrame) => {
      frameQueue = frameQueue
        .then(() => handleFrame(frame))
        .catch((err) => {
          // Never poison the queue — later frames must still be processed.
          console.warn("Relay frame handler failed", err);
        });
    };

    this.streamOpened();

    const stream = new ReadableStream<Uint8Array>({
      start: (streamController) => {
        controller = streamController;

        // Open the message. The SDK's chunk union has an explicit "start"
        // member and useChat needs it before any text part, otherwise the
        // text-start below has no message to attach to.
        emit({ type: "start", messageId: assistantMessageId });
        // This is exactly the point the empty bubble appears, so it is also
        // the point the no-answer watchdog has to start counting.
        armFirstFrameDeadline();

        signal?.addEventListener("abort", () => {
          if (closed) return;
          this.setProgressStatus("idle");
          if (boundJobId !== null) {
            relayClient?.discardAssistantMessage(boundJobId);
          }
          close();
        });
      },
    });

    const subscribePending = () => {
      if (unsubscribe || closed || !relayClient) return;
      unsubscribe = relayClient.onPendingJob(sessionId, enqueueFrame);
    };

    const onSubmitted = (jobId: number | null) => {
      if (!relayClient) return;

      if (closed) {
        // The stream was aborted (or already failed) but the submit went out:
        // the job is live on-chain and its frames will arrive with nobody
        // listening. Tombstone it so the NEXT prompt's pending handler can
        // never adopt them. With a known jobId (wallet mode) the id itself is
        // observed; in delegated mode (jobId null until the first frame) a
        // session-scoped drain swallows the orphan's first frame instead.
        // Deadline tracking still runs so the paid job keeps its
        // Claim Timeout affordance even though nothing renders.
        if (jobId !== null) {
          relayClient.tombstoneJobId(jobId);
          onJobIdResolved(jobId);
        } else {
          relayClient.tombstonePendingSubmission(sessionId);
        }
        return;
      }

      if (!started) {
        this.setProgressStatus("waiting_for_relay");
      }

      if (jobId === null) {
        // Consumer-api returned at broadcast without a jobId. If we took the
        // fallback path we have no subscription yet — retry now that the
        // predecessor has probably bound.
        if (!unsubscribe) {
          try {
            subscribePending();
          } catch (err) {
            fail(
              err instanceof Error
                ? `Cannot subscribe to relay: ${err.message}`
                : "Cannot subscribe to relay"
            );
          }
        }
        return;
      }

      if (unsubscribe) {
        // Converge: promote the existing pending handler instead of adding a
        // second subscription for the same stream.
        const binding = relayClient.bindPendingJob(sessionId, jobId);
        if (binding && !binding.converged) {
          console.warn(
            `Relay stream adopted job ${boundJobId} but submit reported job ${jobId}; re-bound to the submitted job`
          );
        }
      } else {
        unsubscribe = relayClient.onJob(jobId, enqueueFrame);
      }
      resolveJobId(jobId);
    };

    const onSubmitFailed = (error: unknown) => {
      // Frames already flowing means the job is real and streaming; a late
      // submit rejection (fallback path, flaky response) must not kill it.
      if (started || boundJobId !== null) {
        console.warn("Job submit failed after the relay stream started", error);
        return;
      }
      // close() inside fail() settles the deferred persist with a null jobId.
      fail(error instanceof Error ? error.message : "Job submission failed");
    };

    return {
      stream,
      subscribePending,
      onSubmitted,
      onSubmitFailed,
      noteChainObservation,
    };
  }
}

/**
 * Guards against a jobId that is absent or unusable. `Number(undefined)` is
 * NaN, so an API that stops returning jobId surfaces here rather than poisoning
 * the job maps with a NaN key.
 */
function normalizeJobId(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
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
