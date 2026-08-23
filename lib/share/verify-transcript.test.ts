import type { Hex } from "viem";
import { keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { bytesToBase64 } from "@/lib/protocol/base64";
import { responseMismatchDigest } from "@/lib/protocol/verify-response";
import { type OnChainJobFacts, verifyShareEntry } from "./verify-transcript";

const CHAIN_ID = 48_221;
const REGISTRY = "0x9A9f2CCfdE556A7E9Ff0848998Aa4a0CFD8863AE" as const;
const WORKER_KEY =
  "0x7a2d4cfb797a4bd8bc7810fef34f81458581ae28b24cc5e49f55bdce4b171651" as const;
const OTHER_KEY =
  "0xb6610af5f4aa140bdec94d62974f1f8485f8c3b614ffa89671532ee0f2ffabc6" as const;

const worker = privateKeyToAccount(WORKER_KEY);
const other = privateKeyToAccount(OTHER_KEY);

const ciphertext = new TextEncoder().encode("nonce||ciphertext||tag bytes");
const jobId = 141;
const sessionId = 7;

function hex(bytes: Uint8Array): Hex {
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}` as Hex;
}

async function signDigestFor(
  ct: Uint8Array,
  key: Hex = WORKER_KEY
): Promise<Hex> {
  const digest = responseMismatchDigest({
    chainId: CHAIN_ID,
    jobRegistryAddress: REGISTRY,
    jobId,
    sessionId,
    ciphertext: ct,
  });
  return await privateKeyToAccount(key).signMessage({
    message: { raw: digest },
  });
}

function chainJob(overrides?: Partial<OnChainJobFacts>): OnChainJobFacts {
  return {
    worker: worker.address,
    state: 2,
    sessionId,
    responseCiphertextHash: keccak256(hex(ciphertext)),
    ...overrides,
  };
}

describe("verifyShareEntry", () => {
  it("verifies when both legs pass", async () => {
    const result = await verifyShareEntry(
      {
        jobId,
        sessionId,
        ciphertext: bytesToBase64(ciphertext),
        signature: await signDigestFor(ciphertext),
      },
      chainJob(),
      CHAIN_ID,
      REGISTRY
    );
    expect(result.verdict).toBe("verified");
    expect(result.signer?.toLowerCase()).toBe(worker.address.toLowerCase());
  });

  it("reports content mismatch when the ciphertext is tampered", async () => {
    const tampered = new TextEncoder().encode("forged bytes");
    const result = await verifyShareEntry(
      {
        jobId,
        sessionId,
        ciphertext: bytesToBase64(tampered),
        signature: await signDigestFor(tampered),
      },
      chainJob(),
      CHAIN_ID,
      REGISTRY
    );
    expect(result.verdict).toBe("mismatch-content");
  });

  it("reports signature mismatch when another key signed", async () => {
    const result = await verifyShareEntry(
      {
        jobId,
        sessionId,
        ciphertext: bytesToBase64(ciphertext),
        signature: await signDigestFor(ciphertext, OTHER_KEY),
      },
      chainJob(),
      CHAIN_ID,
      REGISTRY
    );
    expect(result.verdict).toBe("mismatch-signature");
    expect(result.signer?.toLowerCase()).toBe(other.address.toLowerCase());
  });

  it("is pending when the job has not completed on chain", async () => {
    const result = await verifyShareEntry(
      { jobId, sessionId, ciphertext: bytesToBase64(ciphertext) },
      chainJob({ state: 1 }),
      CHAIN_ID,
      REGISTRY
    );
    expect(result.verdict).toBe("pending");
  });

  it("is missing-evidence without the ciphertext", async () => {
    const result = await verifyShareEntry(
      { jobId, sessionId, signature: await signDigestFor(ciphertext) },
      chainJob(),
      CHAIN_ID,
      REGISTRY
    );
    expect(result.verdict).toBe("missing-evidence");
  });

  it("is partial when the hash matches but no signature is shared", async () => {
    const result = await verifyShareEntry(
      { jobId, sessionId, ciphertext: bytesToBase64(ciphertext) },
      chainJob(),
      CHAIN_ID,
      REGISTRY
    );
    expect(result.verdict).toBe("partial");
  });

  it("is invalid when the payload sessionId disagrees with the chain", async () => {
    const result = await verifyShareEntry(
      { jobId, sessionId: 999, ciphertext: bytesToBase64(ciphertext) },
      chainJob(),
      CHAIN_ID,
      REGISTRY
    );
    expect(result.verdict).toBe("invalid");
  });
});
