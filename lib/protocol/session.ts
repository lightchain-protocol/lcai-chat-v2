/**
 * Protocol session state machine.
 *
 * Lifecycle: idle → preparing → key_exchange → creating → ready → error
 *
 * Manages the ECDH key exchange, session key lifecycle, and on-chain
 * session creation via the user's wallet (not the gateway).
 */

import type { Abi, Log, PublicClient, WalletClient } from "viem";
import { decodeEventLog, toHex } from "viem";
import { aiConfigAbi } from "@/contracts/ai-config-abi";
import { jobRegistryAbi } from "@/contracts/job-registry-abi";

export type OnChainJob = {
  sessionId: number;
  worker: string;
  /** Raw uint8 matching IJobRegistry.JobState enum: 0=Submitted 1=Acknowledged 2=Completed 3=TimedOut 4=Disputed 5=Resolved 6=Released */
  state: number;
  escrowedFee: bigint;
  submittedAt: number;
  completedAt: number;
  deadline: number;
};
import { workerRegistryAbi } from "@/contracts/worker-registry-abi";

import {
  decrypt,
  encrypt,
  encryptSessionKey,
  generateSessionKey,
  importPublicKey,
} from "./crypto";
import type {
  GatewayClient,
  PendingTokenResponse,
  PrepareSessionResponse,
  SelectSessionResponse,
  TokenResponse,
} from "./gateway-client";
import {
  DelegateNotAuthorizedError,
  GatewayClientError,
  InsufficientPrepaidBalanceError,
} from "./gateway-client";

/**
 * How a job is submitted on-chain:
 *  - "wallet":    user signs a submitJob TX per prompt (legacy default).
 *  - "delegated": consumer-api calls submitJobOnBehalf, debiting the user's
 *                 prepaid balance. No wallet popup. Throws if the delegate
 *                 isn't authorized or the balance is empty.
 *  - "auto":      try "delegated"; on DelegateNotAuthorized / InsufficientBalance
 *                 fall back to "wallet" with the already-uploaded blob.
 */
export type SubmitMode = "wallet" | "delegated" | "auto";

export type SessionStatus =
  | "idle"
  | "preparing"
  | "key_exchange"
  | "creating"
  | "ready"
  | "reassigning"
  | "rewrapping"
  | "error";

export type OnChainSessionState = {
  status: number;
  worker: string;
};

export class MaxReassignmentsError extends Error {
  constructor(sessionId: number, max: number) {
    super(`Session ${sessionId} exceeded max reassignments (${max})`);
    this.name = "MaxReassignmentsError";
  }
}

export class MissingDisputerKeyError extends Error {
  constructor() {
    super(
      "Disputer encryption key not available — session cannot be recovered"
    );
    this.name = "MissingDisputerKeyError";
  }
}

export type ProtocolSession = {
  status: SessionStatus;
  sessionId: number | null;
  relayUrl: string | null;
  relayToken: string | null;
  error: string | null;
};

export type SessionManagerConfig = {
  gateway: GatewayClient;
  modelId: string;
  sessionStorageKey?: string;
  walletClient: WalletClient;
  publicClient: PublicClient;
  jobRegistryAddress: `0x${string}`;
  aiConfigAddress: `0x${string}`;
  workerRegistryAddress: `0x${string}`;
  relayUrl: string;
  /**
   * Returns the submission mode to use for the next prompt. Re-evaluated on
   * every submit so the UI can flip between wallet/delegated mid-session
   * (e.g. after the user deposits + authorizes). Defaults to "wallet".
   */
  getSubmitMode?: () => SubmitMode;
};

/**
 * SessionManager handles the full session creation flow:
 *   1. prepareSession → get worker + encryption key from dispatcher
 *   2. ECDH key exchange → derive shared secret, encrypt session key
 *   3. createSession → on-chain TX via user's wallet
 *   4. getSessionToken → fetch relay JWT once the dispatcher activates the session
 *
 * The 32-byte session key is held in memory for encrypt/decrypt operations.
 * Session metadata is persisted to sessionStorage for tab-scoped recovery.
 */
export class SessionManager {
  private sessionKey: Uint8Array | null = null;
  private modelIdBytes32: `0x${string}` | null = null;
  private disputerEncryptionKey: string | null = null;
  private failoverInProgress = false;
  private state: ProtocolSession = {
    status: "idle",
    sessionId: null,
    relayUrl: null,
    relayToken: null,
    error: null,
  };
  private onStatusChange?: (status: SessionStatus) => void;

  private readonly gateway: GatewayClient;
  private readonly modelId: string;
  private readonly walletClient: WalletClient;
  private readonly publicClient: PublicClient;
  private readonly jobRegistryAddress: `0x${string}`;
  private readonly aiConfigAddress: `0x${string}`;
  private readonly workerRegistryAddress: `0x${string}`;
  private readonly relayUrl: string;
  private readonly sessionStorageKey: string;
  private readonly getSubmitMode: () => SubmitMode;

  constructor(config: SessionManagerConfig) {
    this.gateway = config.gateway;
    this.modelId = config.modelId;
    this.walletClient = config.walletClient;
    this.publicClient = config.publicClient;
    this.jobRegistryAddress = config.jobRegistryAddress;
    this.aiConfigAddress = config.aiConfigAddress;
    this.workerRegistryAddress = config.workerRegistryAddress;
    this.relayUrl = config.relayUrl;
    this.sessionStorageKey = config.sessionStorageKey ?? "lc-protocol-session";
    this.getSubmitMode = config.getSubmitMode ?? (() => "wallet");
    this.tryRestore();
  }

  /** Gateway hex model id (same id used in sessionStorage snapshot). */
  get resolvedModelId(): string {
    return this.modelId;
  }

  get status(): SessionStatus {
    return this.state.status;
  }

  get sessionId(): number | null {
    return this.state.sessionId;
  }

  get relayToken(): string | null {
    return this.state.relayToken;
  }

  getRelayUrl(): string | null {
    return this.state.relayUrl;
  }

  setOnStatusChange(cb: (status: SessionStatus) => void) {
    this.onStatusChange = cb;
  }

  /**
   * Initializes the session if not already ready. Idempotent — safe to call
   * multiple times (returns immediately if already ready or in progress).
   */
  async initialize(): Promise<void> {
    if (this.state.status === "ready") {
      const valid = await this.validateRestoredSession();
      if (valid) {
        return;
      }
      // Stale session — reset and fall through to create a new one
      this.reset();
    }
    if (this.state.status !== "idle" && this.state.status !== "error") {
      return; // Already in progress
    }

    // Check if the wallet has enough balance before preparing the session to avoid misleading errors
    const account = this.walletClient.account;
    if (!account) throw new Error("Wallet account not available");

    const balance = await this.publicClient.getBalance({
      address: account.address,
    });

    if (balance === 0n) {
      throw new Error("Wallet has no balance");
    }

    try {
      // Step 1: Select — dispatcher picks a worker and commits (worker, nonce,
      // expiry) to short-lived storage. We receive the worker's encryption key
      // so we can encrypt the session key for it before returning in Step 3.
      this.setState("preparing");
      let selected = await this.gateway.selectSession(this.modelId);

      // Step 2: ECDH key exchange — encrypt the generated session key for the
      // worker (and disputer, if provided).
      this.setState("key_exchange");
      let keyExchange = await this.performKeyExchange(selected);
      this.sessionKey = keyExchange.sessionKey;

      // Step 3: Prepare — send the encrypted keys back; dispatcher signs the
      // committed (worker, nonce, expiry) tuple with the keys bound into the
      // EIP-712 domain (audit requirement).
      let prepared = await this.gateway.prepareSession({
        modelId: this.modelId,
        encWorkerKey: keyExchange.encWorkerKey,
        encDisputerKey: keyExchange.encDisputerKey,
      });

      // Step 4: Create session on-chain via user's wallet
      this.setState("creating");
      const modelIdBytes32 = padHexTo32Bytes(this.modelId);
      this.modelIdBytes32 = modelIdBytes32;

      let sessionId: number;
      try {
        sessionId = await this.createSessionOnChain(
          modelIdBytes32,
          { ...selected, signature: prepared.signature },
          keyExchange
        );
      } catch (err) {
        // Retry once on stale dispatcher signature (nonce consumed, or the
        // pending selection TTL expired mid-flight — both signal a fresh
        // select → prepare round is needed).
        if (isStaleSignatureError(err) || isPendingSelectionMissing(err)) {
          selected = await this.gateway.selectSession(this.modelId);
          keyExchange = await this.performKeyExchange(selected);
          this.sessionKey = keyExchange.sessionKey;
          prepared = await this.gateway.prepareSession({
            modelId: this.modelId,
            encWorkerKey: keyExchange.encWorkerKey,
            encDisputerKey: keyExchange.encDisputerKey,
          });
          sessionId = await this.createSessionOnChain(
            modelIdBytes32,
            { ...selected, signature: prepared.signature },
            keyExchange
          );
        } else {
          throw err;
        }
      }

      const relayToken = await this.waitForRelayToken(sessionId);

      this.state = {
        status: "ready",
        sessionId,
        relayUrl: this.relayUrl,
        relayToken,
        error: null,
      };
      this.onStatusChange?.("ready");
      this.persist();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.state = {
        ...this.state,
        status: "error",
        error: msg,
      };
      this.onStatusChange?.("error");
      throw err;
    }
  }

  /**
   * Encrypts a plaintext prompt and submits the job.
   *
   * Always: encrypt → upload the encrypted blob via the gateway (which submits
   * the real EIP-4844 blob TX) and get the versioned hashes.
   *
   * Then, based on `getSubmitMode()`:
   *  - "delegated"/"auto": call the consumer-api `POST /api/sessions/:id/messages`
   *    which runs `submitJobOnBehalf`, debiting the user's prepaid balance — no
   *    wallet popup. "auto" falls back to the wallet path on
   *    DelegateNotAuthorized / InsufficientPrepaidBalance (reusing the blob).
   *  - "wallet": user signs a `submitJob` type-2 TX per prompt (legacy).
   *
   * The blob-then-submit split exists because browser wallets (MetaMask)
   * cannot sign type-3 blob transactions with sidecars.
   */
  async submitJob(
    plaintext: string
  ): Promise<{ jobId: number; txHash: string }> {
    if (!this.sessionKey) {
      throw new Error("Session not initialized — no session key");
    }
    if (this.state.sessionId === null) {
      throw new Error("Session ID not available");
    }

    const account = this.walletClient.account;
    if (!account) throw new Error("Wallet account not available");

    // 1. Encrypt → base64
    const encryptedBase64 = await this.encryptPrompt(plaintext);

    // 2. Upload to gateway — gateway submits the real blob TX. Post-audit the
    // on-chain submitJob accepts a single blob hash per job; if the prompt spans
    // multiple blobs we can't fit it in one job under the current contract.
    const blobResponse = await this.gateway.uploadBlob(encryptedBase64);
    const blobHashes = blobResponse.blobHashes as `0x${string}`[];
    if (blobHashes.length === 0) {
      throw new Error("Blob upload returned no hashes");
    }
    if (blobHashes.length > 1) {
      throw new Error(
        `Prompt too large: spans ${blobHashes.length} blobs, but contract accepts only one per job`
      );
    }

    // 3. Choose the submission path.
    const mode = this.getSubmitMode();
    if (mode === "delegated" || mode === "auto") {
      try {
        const result = await this.gateway.submitMessage(
          this.state.sessionId,
          blobHashes[0]
        );

        console.log("result", result.jobId);
        return { jobId: Number(result.jobId), txHash: result.txHash };
      } catch (err) {
        const recoverable =
          err instanceof DelegateNotAuthorizedError ||
          err instanceof InsufficientPrepaidBalanceError;
        if (mode === "delegated" || !recoverable) {
          throw err;
        }
        // mode === "auto" + recoverable → fall through to the wallet path,
        // reusing the blob we already uploaded.
      }
    }

    return this.submitJobViaWallet(blobHashes[0]);
  }

  /** Wallet-signed submitJob path (legacy / fallback). */
  private async submitJobViaWallet(
    blobHash: `0x${string}`
  ): Promise<{ jobId: number; txHash: string }> {
    if (this.state.sessionId === null) {
      throw new Error("Session ID not available");
    }
    const account = this.walletClient.account;
    if (!account) throw new Error("Wallet account not available");

    // Calculate flat per-model fee and check if the user has enough balance
    const [fee, balance] = await Promise.all([
      this.publicClient.readContract({
        address: this.aiConfigAddress,
        abi: aiConfigAbi,
        functionName: "calculateJobFee",
        args: [this.modelIdBytes32 ?? padHexTo32Bytes(this.modelId)],
      }),
      this.publicClient.getBalance({
        address: account.address,
      }),
    ]);

    if (balance < fee) {
      throw new Error("Insufficient balance");
    }

    const callParams = {
      account,
      address: this.jobRegistryAddress,
      abi: jobRegistryAbi,
      functionName: "submitJob",
      args: [BigInt(this.state.sessionId), blobHash],
      value: fee,
    } as const;

    // Estimate gas with a 20% buffer — the ReentrancyGuardTransient cleanup
    // (TSTORE reset) is underestimated by the default gas estimator on Anvil,
    // causing a ReentrancySentryOOG revert despite the main logic completing.
    const gasEstimate = await this.publicClient.estimateContractGas(callParams);

    const { request } = await this.publicClient.simulateContract({
      ...callParams,
      gas: (gasEstimate * 120n) / 100n,
    });

    const hash = await this.walletClient.writeContract(request);

    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      throw new Error(`submitJob TX reverted (tx ${hash})`);
    }

    const jobEvent = parseJobSubmittedEvent(receipt.logs, jobRegistryAbi);
    return { jobId: Number(jobEvent.args.jobId), txHash: hash };
  }

  /**
   * Encrypts a plaintext prompt using the session key.
   * Returns base64-encoded ciphertext suitable for the gateway API.
   */
  async encryptPrompt(plaintext: string): Promise<string> {
    if (!this.sessionKey) {
      throw new Error("Session not initialized — no session key");
    }
    const plaintextBytes = new TextEncoder().encode(plaintext);
    const ciphertext = await encrypt(this.sessionKey, plaintextBytes);
    return uint8ToBase64(ciphertext);
  }

  /**
   * Decrypts a base64-encoded response payload from the relay.
   */
  async decryptResponse(base64Ciphertext: string): Promise<string> {
    if (!this.sessionKey) {
      throw new Error("Session not initialized — no session key");
    }
    const ciphertext = base64ToUint8(base64Ciphertext);
    const plaintext = await decrypt(this.sessionKey, ciphertext);
    return new TextDecoder().decode(plaintext);
  }

  /**
   * Updates the relay token (e.g. after refresh).
   */
  updateToken(token: string) {
    this.state.relayToken = token;
    this.persist();
  }

  /**
   * Returns true if all prerequisites for rewrapping the session key are
   * available (disputer encryption key cached). Call before reassignSession()
   * to avoid stranding the on-chain session in Reassigning state.
   */
  canRewrap(): boolean {
    return this.sessionKey !== null && this.disputerEncryptionKey !== null;
  }

  async reassignSession(): Promise<{ newWorker: string }> {
    if (this.failoverInProgress) {
      throw new Error("Failover already in progress");
    }
    if (this.state.sessionId === null) {
      throw new Error("No active session to reassign");
    }
    const account = this.walletClient.account;
    if (!account) throw new Error("Wallet account not available");

    this.failoverInProgress = true;
    this.setState("reassigning");

    try {
      const sessionIdBig = BigInt(this.state.sessionId);
      const gasEstimate = await this.publicClient.estimateContractGas({
        account,
        address: this.jobRegistryAddress,
        abi: jobRegistryAbi,
        functionName: "reassignSession",
        args: [sessionIdBig],
      });
      const hash = await this.walletClient.writeContract({
        account,
        chain: this.walletClient.chain,
        address: this.jobRegistryAddress,
        abi: jobRegistryAbi,
        functionName: "reassignSession",
        args: [sessionIdBig],
        gas: (gasEstimate * 120n) / 100n,
      });
      const receipt = await this.publicClient.waitForTransactionReceipt({
        hash,
      });
      if (receipt.status !== "success") {
        throw new Error(`reassignSession TX reverted (tx ${hash})`);
      }
      const event = parseSessionReassignedEvent(receipt.logs, jobRegistryAbi);
      return { newWorker: event.args.newWorker };
    } catch (err) {
      this.failoverInProgress = false;
      if (isMaxReassignmentsError(err)) {
        throw new MaxReassignmentsError(
          this.state.sessionId,
          extractMaxFromError(err)
        );
      }
      throw err;
    }
  }

  async rewrapAndUpdateKey(newWorkerAddress: string): Promise<void> {
    if (!this.sessionKey)
      throw new Error("Session not initialized — no session key");
    if (this.state.sessionId === null) throw new Error("No active session");
    const account = this.walletClient.account;
    if (!account) throw new Error("Wallet account not available");

    this.setState("rewrapping");

    try {
      const workerPubKeyHex = await this.publicClient.readContract({
        address: this.workerRegistryAddress,
        abi: workerRegistryAbi,
        functionName: "getWorkerEncryptionKey",
        args: [newWorkerAddress as `0x${string}`],
      });
      const workerPubRaw = hexToUint8(workerPubKeyHex as string);
      const workerPub = await importPublicKey(workerPubRaw);
      const encWorkerKeyBytes = await encryptSessionKey(
        this.sessionKey,
        workerPub
      );

      if (!this.disputerEncryptionKey) throw new MissingDisputerKeyError();
      const disputerPubRaw = hexToUint8(this.disputerEncryptionKey);
      const disputerPub = await importPublicKey(disputerPubRaw);
      const encDisputerKeyBytes = await encryptSessionKey(
        this.sessionKey,
        disputerPub
      );

      const encWorkerKeyHex = toHex(encWorkerKeyBytes);
      const encDisputerKeyHex = toHex(encDisputerKeyBytes);
      const sessionIdBig = BigInt(this.state.sessionId);

      const gasEstimate = await this.publicClient.estimateContractGas({
        account,
        address: this.jobRegistryAddress,
        abi: jobRegistryAbi,
        functionName: "updateSessionKey",
        args: [sessionIdBig, encWorkerKeyHex, encDisputerKeyHex],
      });
      const hash = await this.walletClient.writeContract({
        account,
        chain: this.walletClient.chain,
        address: this.jobRegistryAddress,
        abi: jobRegistryAbi,
        functionName: "updateSessionKey",
        args: [sessionIdBig, encWorkerKeyHex, encDisputerKeyHex],
        gas: (gasEstimate * 120n) / 100n,
      });
      const receipt = await this.publicClient.waitForTransactionReceipt({
        hash,
      });
      if (receipt.status !== "success") {
        throw new Error(`updateSessionKey TX reverted (tx ${hash})`);
      }
      this.setState("ready");
      this.failoverInProgress = false;
      this.persist();
    } catch (err) {
      this.failoverInProgress = false;
      throw err;
    }
  }

  async getOnChainSessionState(): Promise<OnChainSessionState> {
    if (this.state.sessionId === null) throw new Error("No active session");
    const session = await this.publicClient.readContract({
      address: this.jobRegistryAddress,
      abi: jobRegistryAbi,
      functionName: "getSession",
      args: [BigInt(this.state.sessionId)],
    });
    return { status: Number(session.status), worker: session.worker };
  }

  /**
   * Reads the on-chain Job struct for any job ID.
   * Returns state, deadline, escrowedFee, completedAt and other fields.
   */
  async getJob(jobId: number): Promise<OnChainJob> {
    const job = await this.publicClient.readContract({
      address: this.jobRegistryAddress,
      abi: jobRegistryAbi,
      functionName: "getJob",
      args: [BigInt(jobId)],
    });
    return {
      sessionId: Number(job.sessionId),
      worker: job.worker,
      state: job.state,
      escrowedFee: job.escrowedFee,
      submittedAt: Number(job.submittedAt),
      completedAt: Number(job.completedAt),
      deadline: Number(job.deadline),
    };
  }

  /**
   * Calls claimTimeout(jobId) on-chain.
   * The worker missed the deadline — the fee is refunded and the worker is slashed.
   */
  async claimJobTimeout(jobId: number): Promise<{ txHash: string }> {
    const account = this.walletClient.account;
    if (!account) throw new Error("Wallet account not available");

    const callParams = {
      account,
      address: this.jobRegistryAddress,
      abi: jobRegistryAbi,
      functionName: "claimTimeout",
      args: [BigInt(jobId)],
    } as const;

    const gasEstimate = await this.publicClient.estimateContractGas(callParams);
    const { request } = await this.publicClient.simulateContract({
      ...callParams,
      gas: (gasEstimate * 120n) / 100n,
    });
    const hash = await this.walletClient.writeContract(request);
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      throw new Error(`claimTimeout TX reverted (tx ${hash})`);
    }
    return { txHash: hash };
  }

  /**
   * Files a dispute for a completed job.
   * Reads the escrowed fee + bond multiplier from the chain, then calls
   * disputeJob(jobId) with value = bond.
   */
  async disputeJob(jobId: number): Promise<{ txHash: string; bond: bigint }> {
    const account = this.walletClient.account;
    if (!account) throw new Error("Wallet account not available");

    const [job, multiplier] = await Promise.all([
      this.getJob(jobId),
      this.publicClient.readContract({
        address: this.aiConfigAddress,
        abi: aiConfigAbi,
        functionName: "getDisputeBondMultiplier",
      }),
    ]);

    const bond = (job.escrowedFee * multiplier) / 10_000n;

    const callParams = {
      account,
      address: this.jobRegistryAddress,
      abi: jobRegistryAbi,
      functionName: "disputeJob",
      args: [BigInt(jobId)],
      value: bond,
    } as const;

    const gasEstimate = await this.publicClient.estimateContractGas(callParams);
    const { request } = await this.publicClient.simulateContract({
      ...callParams,
      gas: (gasEstimate * 120n) / 100n,
    });
    const hash = await this.walletClient.writeContract(request);
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      throw new Error(`disputeJob TX reverted (tx ${hash})`);
    }
    return { txHash: hash, bond };
  }

  /**
   * Clears in-memory session material and notifies idle.
   * Does not remove the persisted snapshot in sessionStorage — use when
   * tearing down the transport so returning to this chat can tryRestore().
   */
  release() {
    this.sessionKey = null;
    this.modelIdBytes32 = null;
    this.disputerEncryptionKey = null;
    this.failoverInProgress = false;
    this.state = {
      status: "idle",
      sessionId: null,
      relayUrl: null,
      relayToken: null,
      error: null,
    };
    this.onStatusChange?.("idle");
  }

  /**
   * Resets the session and removes the persisted tab snapshot (wallet change).
   */
  reset() {
    this.release();
    try {
      sessionStorage.removeItem(this.sessionStorageKey);
    } catch {
      // sessionStorage unavailable (SSR)
    }
  }

  private async createSessionOnChain(
    modelIdBytes32: `0x${string}`,
    prepared: PrepareSessionResponse,
    keyExchange: { encWorkerKey: string; encDisputerKey: string }
  ): Promise<number> {
    const account = this.walletClient.account;

    const encWorkerKeyHex = toHex(base64ToUint8(keyExchange.encWorkerKey));
    const encDisputerKeyHex = keyExchange.encDisputerKey
      ? toHex(base64ToUint8(keyExchange.encDisputerKey))
      : ("0x" as `0x${string}`);

    const callParams = {
      account,
      address: this.jobRegistryAddress,
      abi: jobRegistryAbi,
      functionName: "createSession",
      args: [
        modelIdBytes32,
        prepared.worker as `0x${string}`,
        encWorkerKeyHex,
        encDisputerKeyHex,
        prepared.signature as `0x${string}`,
        BigInt(prepared.expiry),
      ],
    } as const;

    const gasEstimate = await this.publicClient.estimateContractGas(callParams);

    const { request } = await this.publicClient.simulateContract({
      ...callParams,
      gas: (gasEstimate * 120n) / 100n,
    });

    const hash = await this.walletClient.writeContract(request);

    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      throw new Error(`createSession TX reverted (tx ${hash})`);
    }

    const event = parseSessionCreatedEvent(receipt.logs, jobRegistryAbi);
    return Number(event.args.sessionId);
  }

  private setState(status: SessionStatus) {
    this.state.status = status;
    this.onStatusChange?.(status);
  }

  private async performKeyExchange(selected: SelectSessionResponse): Promise<{
    encWorkerKey: string;
    encDisputerKey: string;
    sessionKey: Uint8Array;
  }> {
    const workerPubRaw = base64ToUint8(selected.workerEncryptionKey);
    const workerPub = await importPublicKey(workerPubRaw);
    const sessionKey = await generateSessionKey();
    const encWorkerKeyBytes = await encryptSessionKey(sessionKey, workerPub);

    let encDisputerKey = "";
    if (selected.disputerEncryptionKey) {
      this.disputerEncryptionKey = selected.disputerEncryptionKey;
      const disputerPubRaw = hexToUint8(selected.disputerEncryptionKey);
      const disputerPub = await importPublicKey(disputerPubRaw);
      const encDisputerKeyBytes = await encryptSessionKey(
        sessionKey,
        disputerPub
      );
      encDisputerKey = uint8ToBase64(encDisputerKeyBytes);
    }

    return {
      encWorkerKey: uint8ToBase64(encWorkerKeyBytes),
      encDisputerKey,
      sessionKey,
    };
  }

  private async waitForRelayToken(sessionId: number): Promise<string> {
    const deadline = Date.now() + 30_000;
    let attempt = 0;
    let lastPendingMessage = "session token not yet available";

    while (Date.now() < deadline) {
      const response = await this.gateway.getSessionToken(sessionId);
      if (isReadyTokenResponse(response)) {
        return response.token;
      }

      lastPendingMessage = response.message;
      attempt += 1;
      await sleep(Math.min(1000 * attempt, 4000));
    }

    throw new Error(`Timed out waiting for relay token: ${lastPendingMessage}`);
  }

  private persist() {
    try {
      const data = {
        version: 2,
        sessionId: this.state.sessionId,
        relayUrl: this.state.relayUrl,
        relayToken: this.state.relayToken,
        modelId: this.modelId,
        sessionKey: this.sessionKey ? uint8ToBase64(this.sessionKey) : null,
        disputerEncryptionKey: this.disputerEncryptionKey,
      };
      sessionStorage.setItem(this.sessionStorageKey, JSON.stringify(data));
    } catch {
      // sessionStorage unavailable (SSR)
    }
  }

  /**
   * Validates that a restored session still exists on-chain and is owned by
   * the connected wallet. Returns false if the session is stale (e.g. chain
   * was restarted) so the caller can reset and create a new one.
   */
  private async validateRestoredSession(): Promise<boolean> {
    if (this.state.sessionId === null) return false;
    const account = this.walletClient.account;
    if (!account) return false;

    try {
      const session = await this.publicClient.readContract({
        address: this.jobRegistryAddress,
        abi: jobRegistryAbi,
        functionName: "getSession",
        args: [BigInt(this.state.sessionId)],
      });
      // session.user must match the connected wallet
      return session.user.toLowerCase() === account.address.toLowerCase();
    } catch {
      // getSession reverts with SessionNotFound or RPC error — session is stale
      return false;
    }
  }

  private tryRestore() {
    try {
      const raw = sessionStorage.getItem(this.sessionStorageKey);
      if (!raw) return;

      const data = JSON.parse(raw);
      if (data.modelId !== this.modelId) return;

      if (data.sessionId != null && data.sessionKey && data.relayToken) {
        this.state = {
          status: "ready",
          sessionId: data.sessionId,
          relayUrl: this.relayUrl,
          relayToken: data.relayToken,
          error: null,
        };
        this.sessionKey = base64ToUint8(data.sessionKey);
        // v2 migration: restore disputerEncryptionKey (absent in v1 sessions)
        this.disputerEncryptionKey = data.disputerEncryptionKey ?? null;
      }
    } catch {
      // sessionStorage unavailable or corrupt — start fresh
    }
  }
}

// ---------------------------------------------------------------------------
// Event parsing helpers — uses viem's decodeEventLog for ABI-based decoding
// ---------------------------------------------------------------------------

function parseSessionCreatedEvent(logs: Log[], abi: Abi) {
  for (const log of logs) {
    try {
      const decoded = decodeEventLog({
        abi,
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName === "SessionCreated")
        return decoded as typeof decoded & {
          args: {
            sessionId: bigint;
            user: `0x${string}`;
            modelId: `0x${string}`;
          };
        };
    } catch {
      // eslint-disable-next-line no-empty
    }
  }
  throw new Error("SessionCreated event not found in receipt");
}

function parseJobSubmittedEvent(logs: Log[], abi: Abi) {
  for (const log of logs) {
    try {
      const decoded = decodeEventLog({
        abi,
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName === "JobSubmitted")
        return decoded as typeof decoded & {
          args: { jobId: bigint; sessionId: bigint };
        };
    } catch {
      // eslint-disable-next-line no-empty
    }
  }
  throw new Error("JobSubmitted event not found in receipt");
}

function parseSessionReassignedEvent(logs: Log[], abi: Abi) {
  for (const log of logs) {
    try {
      const decoded = decodeEventLog({
        abi,
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName === "SessionReassigned")
        return decoded as typeof decoded & {
          args: { sessionId: bigint; newWorker: `0x${string}` };
        };
    } catch {
      // Not every log is a SessionReassigned event — skip decode failures.
    }
  }
  throw new Error("SessionReassigned event not found in receipt");
}

const MAX_REASSIGNMENTS_PATTERN = /MaxReassignmentsExceeded\([^,]+,\s*(\d+)\)/i;

function isMaxReassignmentsError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  if (msg.includes("maxreassignmentsexceeded")) return true;
  if ("cause" in err && err.cause instanceof Error) {
    return isMaxReassignmentsError(err.cause);
  }
  return false;
}

function extractMaxFromError(err: unknown): number {
  if (!(err instanceof Error)) return 0;
  const match = err.message.match(MAX_REASSIGNMENTS_PATTERN);
  return match ? Number(match[1]) : 0;
}

// ---------------------------------------------------------------------------
// Stale-signature detection
// ---------------------------------------------------------------------------

function isStaleSignatureError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  // Match contract custom error selectors or message strings
  return (
    msg.includes("invaliddispatchersignature") ||
    msg.includes("signatureexpired") ||
    msg.includes("invalid dispatcher signature") ||
    msg.includes("signature expired")
  );
}

// Dispatcher returns 409 no_pending_selection when the prepare phase arrives
// without a prior select (or after the select TTL expired). Re-running the
// select → prepare pair is the correct recovery.
function isPendingSelectionMissing(err: unknown): boolean {
  if (err instanceof GatewayClientError) {
    return err.status === 409 && err.body.includes("no_pending_selection");
  }
  return false;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isReadyTokenResponse(
  response: TokenResponse | PendingTokenResponse
): response is TokenResponse {
  return "token" in response && Boolean(response.token);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function padHexTo32Bytes(hex: string): `0x${string}` {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  return `0x${clean.padStart(64, "0")}` as `0x${string}`;
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToUint8(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function hexToUint8(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(clean.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
