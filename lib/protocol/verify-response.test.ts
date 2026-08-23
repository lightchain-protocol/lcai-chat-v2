import type { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import {
  captureResponseProof,
  checkProofAgainstChain,
  recoverProofSigner,
  responseMismatchDigest,
} from "./verify-response";

// Fixed domain inputs matching devnet-v2; the digest/ciphertext-hash values
// below are known-answer vectors generated once from the Go-side reference
// (lightchain-worker/internal/pipeline/handler.go responseMismatchDigest) and
// must not change unless the contract's SettlementLib encoding changes.
const CHAIN_ID = 48_221;
const JOB_REGISTRY = "0x9A9f2CCfdE556A7E9Ff0848998Aa4a0CFD8863AE" as const;
const JOB_ID = 141;
const SESSION_ID = 7;
// "0xdeadbeef" as bytes.
const CIPHERTEXT = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
const EXPECTED_DIGEST =
  "0xe44b43aaf76ab55c4361fe64889e07cbdd3a5fe3f8d17ac0ca197492698f4d4e";
const EXPECTED_CIPHERTEXT_HASH =
  "0xd4fd4e189132273036449fc9e11198c739161b4c0116a9a2dccdfa1c492006f1";

// Arbitrary valid secp256k1 test key — recovery is symmetric, so any key works.
const WORKER_KEY =
  "0x5de4111add3b4a65ca9b8a29b02c1c88a5b9e45e4b46f5a4d39d2e5f5c2e3d54" as Hex;

const ZERO_HASH =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

async function signDigest(digest: Hex, key: Hex): Promise<Hex> {
  const account = privateKeyToAccount(key);
  // The worker signs accounts.TextHash(digest) — EIP-191 over the raw 32
  // bytes — which is exactly what signMessage with a raw message produces.
  return await account.signMessage({ message: { raw: digest } });
}

async function makeProof(key: Hex) {
  const signature = await signDigest(
    responseMismatchDigest({
      chainId: CHAIN_ID,
      jobRegistryAddress: JOB_REGISTRY,
      jobId: JOB_ID,
      sessionId: SESSION_ID,
      ciphertext: CIPHERTEXT,
    }),
    key
  );
  const worker = privateKeyToAccount(key).address;
  const proof = await captureResponseProof({
    chainId: CHAIN_ID,
    jobRegistryAddress: JOB_REGISTRY,
    jobId: JOB_ID,
    sessionId: SESSION_ID,
    ciphertext: CIPHERTEXT,
    signature,
  });
  return { proof, worker, signature };
}

describe("responseMismatchDigest", () => {
  it("matches the Go/contract known-answer vector", () => {
    const digest = responseMismatchDigest({
      chainId: CHAIN_ID,
      jobRegistryAddress: JOB_REGISTRY,
      jobId: JOB_ID,
      sessionId: SESSION_ID,
      ciphertext: CIPHERTEXT,
    });
    expect(digest).toBe(EXPECTED_DIGEST);
  });
});

describe("captureResponseProof", () => {
  it("persists the raw signature, the signed digest, and the ciphertext hash", async () => {
    const { proof, worker, signature } = await makeProof(WORKER_KEY);

    expect(proof.signature).toBe(signature);
    expect(proof.signedDigest).toBe(EXPECTED_DIGEST);
    expect(proof.localCiphertextHash).toBe(EXPECTED_CIPHERTEXT_HASH);
    expect(proof.hadSignature).toBe(true);
    expect(proof.recoveredSigner?.toLowerCase()).toBe(worker.toLowerCase());
  });

  it("records a missing signature without inventing one", async () => {
    const proof = await captureResponseProof({
      chainId: CHAIN_ID,
      jobRegistryAddress: JOB_REGISTRY,
      jobId: JOB_ID,
      sessionId: SESSION_ID,
      ciphertext: CIPHERTEXT,
      signature: null,
    });
    expect(proof.signature).toBeNull();
    expect(proof.signedDigest).toBeNull();
    expect(proof.recoveredSigner).toBeNull();
    expect(proof.hadSignature).toBe(false);
  });
});

describe("recoverProofSigner", () => {
  it("re-derives the signer from the persisted pair, ignoring the stored address", async () => {
    const { proof, worker } = await makeProof(WORKER_KEY);

    // Simulate a tampered database row: the stored signer claims a different
    // address. Render-time recovery must not believe it.
    const tampered = {
      ...proof,
      recoveredSigner: "0x000000000000000000000000000000000000dead" as Address,
    };
    const signer = await recoverProofSigner(tampered);
    expect(signer?.toLowerCase()).toBe(worker.toLowerCase());
  });

  it("returns null when the persisted signature does not recover", async () => {
    const { proof } = await makeProof(WORKER_KEY);
    const broken = { ...proof, signature: "0x1234" as Hex };
    expect(await recoverProofSigner(broken)).toBeNull();
  });

  it("falls back to the stored signer for legacy proofs without a signature", async () => {
    const { proof } = await makeProof(WORKER_KEY);
    const legacy = {
      jobId: proof.jobId,
      sessionId: proof.sessionId,
      localCiphertextHash: proof.localCiphertextHash,
      recoveredSigner: proof.recoveredSigner,
      hadSignature: proof.hadSignature,
    };
    expect(await recoverProofSigner(legacy)).toBe(proof.recoveredSigner);
  });
});

describe("checkProofAgainstChain with render-time recovery", () => {
  const settledJob = (worker: string) => ({
    worker,
    responseCiphertextHash: EXPECTED_CIPHERTEXT_HASH as Hex,
  });

  it("verifies when the re-recovered signer and the hash both match", async () => {
    const { proof, worker } = await makeProof(WORKER_KEY);
    const freshSigner = await recoverProofSigner(proof);
    const result = checkProofAgainstChain(
      proof,
      settledJob(worker),
      freshSigner
    );
    expect(result.status).toBe("verified");
    expect(result.signatureMatches).toBe(true);
    expect(result.ciphertextMatches).toBe(true);
  });

  it("reports mismatch when the chain committed a different ciphertext hash", async () => {
    const { proof, worker } = await makeProof(WORKER_KEY);
    const freshSigner = await recoverProofSigner(proof);
    const job = {
      worker,
      responseCiphertextHash:
        "0x0000000000000000000000000000000000000000000000000000000000000042" as Hex,
    };
    const result = checkProofAgainstChain(proof, job, freshSigner);
    expect(result.status).toBe("mismatch");
    expect(result.ciphertextMatches).toBe(false);
  });

  it("reports mismatch when the chain assigned a different worker, even if the stored signer was tampered to match", async () => {
    const { proof } = await makeProof(WORKER_KEY);
    const otherWorker = privateKeyToAccount(
      "0xe0b295b5eae2f499f6c499020ece2a89d6a5f44391cfe2dbb0e5c5a418969fec"
    ).address;
    // Tampered row claims the signature belongs to the on-chain worker.
    const tampered = { ...proof, recoveredSigner: otherWorker };
    const freshSigner = await recoverProofSigner(tampered);
    const result = checkProofAgainstChain(
      tampered,
      settledJob(otherWorker),
      freshSigner
    );
    expect(result.status).toBe("mismatch");
    expect(result.signatureMatches).toBe(false);
  });

  it("treats an unsettled job as unverified rather than mismatch", async () => {
    const { proof, worker } = await makeProof(WORKER_KEY);
    const freshSigner = await recoverProofSigner(proof);
    const result = checkProofAgainstChain(
      proof,
      { worker, responseCiphertextHash: ZERO_HASH as Hex },
      freshSigner
    );
    expect(result.status).toBe("unverified");
    expect(result.ciphertextMatches).toBeNull();
  });
});
