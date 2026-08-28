import type { Address, Hex } from "viem";
import { keccak256, recoverMessageAddress } from "viem";
import { base64ToBytes } from "@/lib/protocol/base64";
import { isCompletedJobState } from "@/lib/protocol/job-state";
import { responseMismatchDigest } from "@/lib/protocol/verify-response";

/**
 * Verifier-side logic for shareable verifiable transcripts.
 *
 * Implements bc-2-duel-and-verifier-spec.md §2.3 byte-exactly by reusing
 * `responseMismatchDigest` from verify-response.ts (the same function the
 * in-app proof check uses), and §2.5's verdict table. Everything this module
 * cannot prove is the caller's display problem — §2.4's honesty boundary is
 * rendered by the share page verbatim.
 *
 * What one entry proves when both checks pass: "the worker whose address is
 * recorded on chain for this job signed exactly these ciphertext bytes, and
 * the hash of these bytes is what that worker committed in completeJob".
 * Nothing more — not the plaintext, not content quality, not blob content.
 */

export type SharedProofPayload = {
  jobId: number;
  sessionId: number;
  /**
   * Base64 full response ciphertext from the terminal frame. Present only
   * when the share was created in the live session that received the answer —
   * the ciphertext is never persisted, so post-reload shares omit it and can
   * only ever reach the "missing evidence" verdict.
   */
  ciphertext?: string;
  /** 65-byte worker EIP-191 signature, 0x-prefixed hex. */
  signature?: Hex;
  /** Sharer-provided plaintext. Display-only; NOT independently verifiable. */
  renderedText?: string;
};

export type ShareVerdict =
  | "verified"
  | "mismatch-content"
  | "mismatch-signature"
  | "pending"
  | "partial"
  | "missing-evidence"
  | "invalid";

export const SHARE_VERDICT_LABELS: Record<ShareVerdict, string> = {
  verified:
    "Verified — signed by the worker recorded on chain; bytes match the on-chain commitment",
  "mismatch-content":
    "Mismatch — content does not match the on-chain commitment",
  "mismatch-signature":
    "Mismatch — signature does not belong to the assigned worker",
  pending: "Pending/unverifiable — job has not settled on chain",
  partial:
    "Partial — commitment matches; no worker signature in the share payload",
  "missing-evidence":
    "Unverifiable — the share payload carries no ciphertext, so neither leg can be recomputed",
  invalid: "Invalid — the payload does not match the on-chain job",
};

/** Subset of JobRegistry.getJob the verifier needs (Completed/Resolved/Released all count). */
export type OnChainJobFacts = {
  worker: string;
  state: number;
  sessionId: number;
  responseCiphertextHash: Hex;
};

export type ShareVerdictResult = {
  verdict: ShareVerdict;
  /** Recovered signer when a signature was present, whatever the verdict. */
  signer?: Address;
  /** keccak256 of the payload ciphertext when present. */
  ciphertextHash?: Hex;
};

export async function verifyShareEntry(
  payload: SharedProofPayload,
  onChain: OnChainJobFacts,
  chainId: number,
  jobRegistryAddress: Address
): Promise<ShareVerdictResult> {
  // The payload's sessionId is trusted for digest recomputation only after it
  // matches the chain — otherwise the digest commits to the wrong session.
  if (onChain.sessionId !== payload.sessionId) {
    return { verdict: "invalid" };
  }
  if (!isCompletedJobState(onChain.state)) {
    return { verdict: "pending" };
  }
  if (!payload.ciphertext) {
    return { verdict: "missing-evidence" };
  }

  const ciphertext = base64ToBytes(payload.ciphertext);
  const ciphertextHash = keccak256(
    // viem's keccak256 takes hex; convert without another helper.
    `0x${Array.from(ciphertext, (b) => b.toString(16).padStart(2, "0")).join("")}` as Hex
  );
  const hashMatches =
    ciphertextHash.toLowerCase() ===
    onChain.responseCiphertextHash.toLowerCase();

  if (!payload.signature) {
    return {
      verdict: hashMatches ? "partial" : "mismatch-content",
      ciphertextHash,
    };
  }

  const digest = responseMismatchDigest({
    chainId,
    jobRegistryAddress,
    jobId: payload.jobId,
    sessionId: payload.sessionId,
    ciphertext,
  });
  const signer = await recoverMessageAddress({
    message: { raw: digest },
    signature: payload.signature,
  });
  const signatureMatches =
    signer.toLowerCase() === onChain.worker.toLowerCase();

  const verdict: ShareVerdict = hashMatches
    ? signatureMatches
      ? "verified"
      : "mismatch-signature"
    : "mismatch-content";
  return { verdict, signer, ciphertextHash };
}

/**
 * Phase-2 wording switch for the blob-availability caveat (§2.4.3). Kept
 * data-driven: flipping the flag changes the sentence, not the code.
 */
export const PHASE2_BLOBHASH_DEPLOYED = false;

export const BLOB_CAVEAT = PHASE2_BLOBHASH_DEPLOYED
  ? "The response blob's existence at completion is proven; its content is unretrievable after pruning (~18 days)."
  : "The committed blob hash is shown, but post-hoc nothing confirms a blob with that content ever existed (pre-Phase-2 the hash is an unbound value; blobs prune after ~18 days).";
