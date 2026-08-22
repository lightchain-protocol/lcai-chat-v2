/**
 * Client-side verification that an answer really came from the worker that was
 * paid for it.
 *
 * Every response the worker publishes is signed, and the signature already
 * arrives in the browser on the terminal relay frame — it was simply ignored.
 * Combined with the commitments in the on-chain Job struct, that is enough to
 * check two independent things without trusting the relay, the API, or any
 * server in between:
 *
 *   1. The signature recovers to the worker the chain says was assigned.
 *   2. The bytes that were decrypted and rendered hash to the value the worker
 *      committed in completeJob.
 *
 * Both checks run against data the client already has. Neither requires a
 * round trip, and a failure of either is exactly the evidence
 * JobRegistry.disputeResponseMismatch expects.
 */

import {
  type Address,
  encodeAbiParameters,
  type Hex,
  keccak256,
  parseAbiParameters,
  recoverMessageAddress,
} from "viem";

export type VerificationStatus =
  | "verified"
  | "unverified"
  | "mismatch"
  | "pending";

export type ResponseVerification = {
  status: VerificationStatus;
  /** Address recovered from the worker signature, when one was present. */
  recoveredSigner: Address | null;
  /** The worker the chain says was assigned this job. */
  expectedWorker: Address | null;
  signatureMatches: boolean | null;
  ciphertextMatches: boolean | null;
  /** Human-readable reason, present whenever status is not "verified". */
  detail: string | null;
};

export type VerifyInput = {
  chainId: number;
  jobRegistryAddress: Address;
  jobId: number;
  sessionId: number;
  /** Full response ciphertext exactly as the terminal frame carried it. */
  ciphertext: Uint8Array | null;
  /** Worker signature from the terminal frame, or null if none arrived. */
  signature: Hex | null;
  /** Worker recorded on chain for this job. */
  onChainWorker: Address | null;
  /** responseCiphertextHash committed by completeJob. */
  onChainCiphertextHash: Hex | null;
};

/**
 * Recomputes the digest JobRegistry.disputeResponseMismatch verifies:
 * keccak256(abi.encode(chainId, jobRegistry, jobId, sessionId, ciphertext)).
 *
 * Must stay byte-identical to responseMismatchDigest in
 * lightchain-worker/internal/pipeline/handler.go, or a genuine response will
 * read as forged.
 */
export function responseMismatchDigest(input: {
  chainId: number;
  jobRegistryAddress: Address;
  jobId: number;
  sessionId: number;
  ciphertext: Uint8Array;
}): Hex {
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters("uint256, address, uint256, uint256, bytes"),
      [
        BigInt(input.chainId),
        input.jobRegistryAddress,
        BigInt(input.jobId),
        BigInt(input.sessionId),
        bytesToHex(input.ciphertext),
      ]
    )
  );
}

function bytesToHex(bytes: Uint8Array): Hex {
  let out = "0x";
  for (const b of bytes) {
    out += b.toString(16).padStart(2, "0");
  }
  return out as Hex;
}

function sameAddress(a: string | null, b: string | null): boolean {
  return a !== null && b !== null && a.toLowerCase() === b.toLowerCase();
}

/**
 * Evidence captured once, when the terminal frame arrives.
 *
 * The full ciphertext is deliberately not persisted — it would roughly double
 * the storage of every message. Everything needed to re-check the on-chain
 * commitment after a reload is derivable from these few fields, because the
 * expensive input (the ciphertext) is only required at the moment of receipt.
 */
export type ResponseProof = {
  jobId: number;
  sessionId: number;
  /** keccak256 of the response ciphertext, computed locally at receipt. */
  localCiphertextHash: Hex;
  /** Address recovered from the worker signature at receipt, if any. */
  recoveredSigner: Address | null;
  /** Whether a worker signature was present on the terminal frame. */
  hadSignature: boolean;
};

export function decodeBase64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** Builds the persistable proof from a terminal frame. */
export async function captureResponseProof(input: {
  chainId: number;
  jobRegistryAddress: Address;
  jobId: number;
  sessionId: number;
  ciphertext: Uint8Array;
  signature: Hex | null;
}): Promise<ResponseProof> {
  let recoveredSigner: Address | null = null;
  if (input.signature) {
    try {
      recoveredSigner = await recoverMessageAddress({
        message: {
          raw: responseMismatchDigest({
            chainId: input.chainId,
            jobRegistryAddress: input.jobRegistryAddress,
            jobId: input.jobId,
            sessionId: input.sessionId,
            ciphertext: input.ciphertext,
          }),
        },
        signature: input.signature,
      });
    } catch {
      // A signature that will not recover is itself a finding; leaving the
      // signer null surfaces it as unverified rather than throwing here.
    }
  }

  return {
    jobId: input.jobId,
    sessionId: input.sessionId,
    localCiphertextHash: keccak256(bytesToHex(input.ciphertext)),
    recoveredSigner,
    hadSignature: input.signature !== null,
  };
}

/**
 * Re-checks a captured proof against current chain state.
 *
 * Runs on every render of the proof panel, including long after the fact, so
 * a user can confirm the answer still matches what the chain says.
 */
export function checkProofAgainstChain(
  proof: ResponseProof,
  job: {
    worker: string;
    responseCiphertextHash: Hex;
  } | null
): ResponseVerification {
  if (!job) {
    return {
      status: "pending",
      recoveredSigner: proof.recoveredSigner,
      expectedWorker: null,
      signatureMatches: null,
      ciphertextMatches: null,
      detail: "Reading the job from the chain.",
    };
  }

  const settled =
    job.responseCiphertextHash !== ZERO_HASH &&
    job.responseCiphertextHash.length > 2;
  const ciphertextMatches = settled
    ? proof.localCiphertextHash.toLowerCase() ===
      job.responseCiphertextHash.toLowerCase()
    : null;
  const signatureMatches = proof.recoveredSigner
    ? sameAddress(proof.recoveredSigner, job.worker)
    : null;

  if (ciphertextMatches === false || signatureMatches === false) {
    return {
      status: "mismatch",
      recoveredSigner: proof.recoveredSigner,
      expectedWorker: job.worker as Address,
      signatureMatches,
      ciphertextMatches,
      detail:
        ciphertextMatches === false
          ? "The answer does not match the hash the worker committed on chain."
          : "The signature does not belong to the worker the chain assigned.",
    };
  }

  if (ciphertextMatches === true && signatureMatches === true) {
    return {
      status: "verified",
      recoveredSigner: proof.recoveredSigner,
      expectedWorker: job.worker as Address,
      signatureMatches: true,
      ciphertextMatches: true,
      detail: null,
    };
  }

  return {
    status: "unverified",
    recoveredSigner: proof.recoveredSigner,
    expectedWorker: job.worker as Address,
    signatureMatches,
    ciphertextMatches,
    detail: settled
      ? "No worker signature arrived with this response."
      : "The job has not settled on chain yet.",
  };
}

const ZERO_HASH =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

export async function verifyResponse(
  input: VerifyInput
): Promise<ResponseVerification> {
  const base: ResponseVerification = {
    status: "pending",
    recoveredSigner: null,
    expectedWorker: input.onChainWorker,
    signatureMatches: null,
    ciphertextMatches: null,
    detail: null,
  };

  if (!input.ciphertext || input.ciphertext.length === 0) {
    return {
      ...base,
      status: "unverified",
      detail: "No response ciphertext was captured for this answer.",
    };
  }

  // Check the on-chain commitment first: it needs no signature and catches
  // the case where the rendered text is not what was settled.
  let ciphertextMatches: boolean | null = null;
  if (input.onChainCiphertextHash) {
    const local = keccak256(bytesToHex(input.ciphertext));
    ciphertextMatches =
      local.toLowerCase() === input.onChainCiphertextHash.toLowerCase();
  }

  let recoveredSigner: Address | null = null;
  let signatureMatches: boolean | null = null;
  if (input.signature && input.onChainWorker) {
    try {
      const digest = responseMismatchDigest({
        chainId: input.chainId,
        jobRegistryAddress: input.jobRegistryAddress,
        jobId: input.jobId,
        sessionId: input.sessionId,
        ciphertext: input.ciphertext,
      });
      // The worker signs with EIP-191 over the digest, so recovery has to
      // treat the digest as raw message bytes rather than as a string.
      recoveredSigner = await recoverMessageAddress({
        message: { raw: digest },
        signature: input.signature,
      });
      signatureMatches = sameAddress(recoveredSigner, input.onChainWorker);
    } catch {
      signatureMatches = false;
    }
  }

  if (ciphertextMatches === false || signatureMatches === false) {
    return {
      ...base,
      recoveredSigner,
      signatureMatches,
      ciphertextMatches,
      status: "mismatch",
      detail:
        ciphertextMatches === false
          ? "The response does not match the hash committed on chain."
          : "The signature does not belong to the worker assigned on chain.",
    };
  }

  if (ciphertextMatches === true && signatureMatches === true) {
    return {
      ...base,
      recoveredSigner,
      signatureMatches,
      ciphertextMatches,
      status: "verified",
      detail: null,
    };
  }

  // One check passed and the other had nothing to compare against. Saying
  // "verified" here would overclaim.
  return {
    ...base,
    recoveredSigner,
    signatureMatches,
    ciphertextMatches,
    status: "unverified",
    detail: input.signature
      ? "The job has not settled on chain yet, so the commitment cannot be checked."
      : "No worker signature arrived with this response.",
  };
}
