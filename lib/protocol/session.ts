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
  TokenResponse,
} from "./gateway-client";

export type SessionStatus =
  | "idle"
  | "preparing"
  | "key_exchange"
  | "creating"
  | "ready"
  | "error";

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
  walletClient: WalletClient;
  publicClient: PublicClient;
  jobRegistryAddress: `0x${string}`;
  aiConfigAddress: `0x${string}`;
  relayUrl: string;
};

const SESSION_STORAGE_KEY = "lc-protocol-session";

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
  private readonly relayUrl: string;

  constructor(config: SessionManagerConfig) {
    this.gateway = config.gateway;
    this.modelId = config.modelId;
    this.walletClient = config.walletClient;
    this.publicClient = config.publicClient;
    this.jobRegistryAddress = config.jobRegistryAddress;
    this.aiConfigAddress = config.aiConfigAddress;
    this.relayUrl = config.relayUrl;
    this.tryRestore();
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
      if (valid) return;
      // Stale session — reset and fall through to create a new one
      this.reset();
    }
    if (this.state.status !== "idle" && this.state.status !== "error") {
      return; // Already in progress
    }

    try {
      // Step 1: Prepare — get worker recommendation from dispatcher
      this.setState("preparing");
      let prepared = await this.gateway.prepareSession(this.modelId);

      // Step 2: ECDH key exchange
      this.setState("key_exchange");
      let keyExchange = await this.performKeyExchange(prepared);
      this.sessionKey = keyExchange.sessionKey;

      // Step 3: Create session on-chain via user's wallet
      this.setState("creating");
      const modelIdBytes32 = padHexTo32Bytes(this.modelId);
      this.modelIdBytes32 = modelIdBytes32;

      let sessionId: number;
      try {
        sessionId = await this.createSessionOnChain(
          modelIdBytes32,
          prepared,
          keyExchange
        );
      } catch (err) {
        // Retry once on stale dispatcher signature (nonce already consumed)
        if (isStaleSignatureError(err)) {
          prepared = await this.gateway.prepareSession(this.modelId);
          keyExchange = await this.performKeyExchange(prepared);
          this.sessionKey = keyExchange.sessionKey;
          sessionId = await this.createSessionOnChain(
            modelIdBytes32,
            prepared,
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
   * Encrypts a plaintext prompt and submits the job in two steps:
   *   1. Upload encrypted data to the gateway, which submits the real EIP-4844
   *      blob TX and returns the versioned hashes.
   *   2. Call submitJob on-chain as a regular type-2 TX with those hashes.
   *
   * This two-step flow is needed because browser wallets (MetaMask) cannot
   * sign type-3 blob transactions with sidecars.
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
    const dataLength = BigInt(base64ToUint8(encryptedBase64).length);

    // 2. Upload to gateway — gateway submits the real blob TX
    const blobResponse = await this.gateway.uploadBlob(encryptedBase64);
    const blobHashes = blobResponse.blobHashes as `0x${string}`[];

    // 3. Calculate fee using encrypted size
    const fee = await this.publicClient.readContract({
      address: this.aiConfigAddress,
      abi: aiConfigAbi,
      functionName: "calculateJobFee",
      args: [this.modelIdBytes32 ?? padHexTo32Bytes(this.modelId), dataLength],
    });

    // 4. Check if the user has enough balance
    const balance = await this.publicClient.getBalance({
      address: account.address,
    });

    if (balance < fee) {
      throw new Error("Insufficient balance");
    }

    const callParams = {
      account,
      address: this.jobRegistryAddress,
      abi: jobRegistryAbi,
      functionName: "submitJob",
      args: [BigInt(this.state.sessionId), blobHashes, dataLength],
      value: fee,
    } as const;

    // 5. Estimate gas with a 20% buffer — the ReentrancyGuardTransient cleanup
    // (TSTORE reset) is underestimated by the default gas estimator on Anvil,
    // causing a ReentrancySentryOOG revert despite the main logic completing.
    const gasEstimate = await this.publicClient.estimateContractGas(callParams);

    // 6. Simulate the transaction
    const { request } = await this.publicClient.simulateContract({
      ...callParams,
      gas: (gasEstimate * 120n) / 100n,
    });

    // 7. Submit job on-chain as a regular type-2 TX
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
   * Resets the session to idle state.
   */
  reset() {
    this.sessionKey = null;
    this.modelIdBytes32 = null;
    this.state = {
      status: "idle",
      sessionId: null,
      relayUrl: null,
      relayToken: null,
      error: null,
    };
    this.onStatusChange?.("idle");
    try {
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
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
    if (!account) throw new Error("Wallet account not available");

    const encWorkerKeyHex = toHex(base64ToUint8(keyExchange.encWorkerKey));
    const encDisputerKeyHex = keyExchange.encDisputerKey
      ? toHex(base64ToUint8(keyExchange.encDisputerKey))
      : ("0x" as `0x${string}`);

    const balance = await this.publicClient.getBalance({
      address: account.address,
    });

    if (balance === 0n) {
      throw new Error("Wallet has no balance");
    }

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

  private async performKeyExchange(prepared: PrepareSessionResponse): Promise<{
    encWorkerKey: string;
    encDisputerKey: string;
    sessionKey: Uint8Array;
  }> {
    const workerPubRaw = base64ToUint8(prepared.workerEncryptionKey);
    const workerPub = await importPublicKey(workerPubRaw);
    const sessionKey = await generateSessionKey();
    const encWorkerKeyBytes = await encryptSessionKey(sessionKey, workerPub);

    let encDisputerKey = "";
    if (prepared.disputerEncryptionKey) {
      const disputerPubRaw = hexToUint8(prepared.disputerEncryptionKey);
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
        sessionId: this.state.sessionId,
        relayUrl: this.state.relayUrl,
        relayToken: this.state.relayToken,
        modelId: this.modelId,
        sessionKey: this.sessionKey ? uint8ToBase64(this.sessionKey) : null,
      };
      sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(data));
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
      const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
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
