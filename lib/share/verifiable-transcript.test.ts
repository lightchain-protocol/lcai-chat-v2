import { describe, expect, it } from "vitest";
import type { GenerationStats } from "@/lib/protocol/relay-client";
import type { SettlementProgress } from "@/lib/protocol/settlement";
import type { StreamMetricsSnapshot } from "@/lib/protocol/stream-metrics";
import type { ResponseProof } from "@/lib/protocol/verify-response";
import type { ChatMessage } from "@/lib/types";
import { buildVerifiableTranscript } from "./verifiable-transcript";

const proof: ResponseProof = {
  jobId: 42,
  sessionId: 7,
  localCiphertextHash: "0xaaaa",
  recoveredSigner: "0xbbbb",
  hadSignature: true,
  signature: "0xcccc",
  signedDigest: "0xdddd",
};

const settlement: SettlementProgress = {
  stage: "settled",
  escrowedAtMs: 1000,
  worker: "0xeeee",
  escrowedFeeWei: "1000000000000000000",
  acknowledgedAtMs: 2000,
  acknowledgedOnChain: true,
  firstFrameAtMs: 3000,
  firstTextAtMs: 3500,
  settledAtMs: 9000,
  settledOnChainSec: 10,
};

const stats: GenerationStats = {
  promptTokens: 10,
  evalTokens: 50,
  tokensPerSecond: 25.5,
  promptEvalMs: 100,
  evalMs: 2000,
  totalMs: 2100,
};

const metrics: StreamMetricsSnapshot = {
  firstPayloadMs: 2000,
  ttftMs: 2500,
  textChars: 400,
  elapsedMs: 5000,
  charsPerSecond: 80,
  tokensPerSecondEstimate: 20,
};

function assistantMessage(parts: ChatMessage["parts"]): ChatMessage {
  return {
    id: "m-assistant",
    role: "assistant",
    metadata: { createdAt: "2026-08-23T00:00:00.000Z", jobId: 42 },
    parts,
  };
}

describe("buildVerifiableTranscript", () => {
  it("extracts proof, settlement, stats and metrics from data parts", () => {
    const message = assistantMessage([
      { type: "text", text: "Hello " },
      { type: "text", text: "world" },
      { type: "data-responseProof", data: proof },
      { type: "data-settlement", data: settlement },
      { type: "data-generationStats", data: stats },
      { type: "data-streamMetrics", data: metrics },
    ]);

    const doc = buildVerifiableTranscript({
      chatId: "chat-1",
      title: "Demo",
      messages: [message],
      now: () => 1_800_000_000_000,
    });

    expect(doc.v).toBe(1);
    expect(doc.exportedAt).toBe(new Date(1_800_000_000_000).toISOString());
    expect(doc.chat).toEqual({ id: "chat-1", title: "Demo" });
    expect(doc.messages).toHaveLength(1);

    const entry = doc.messages[0];
    expect(entry.role).toBe("assistant");
    expect(entry.text).toBe("Hello world");
    expect(entry.jobId).toBe(42);
    expect(entry.proof).toEqual(proof);
    expect(entry.settlement).toEqual(settlement);
    expect(entry.generationStats).toEqual(stats);
    expect(entry.streamMetrics).toEqual(metrics);
  });

  it("carries the serving model from protocolMeta", () => {
    const first: ChatMessage = {
      ...assistantMessage([{ type: "text", text: "deep answer" }]),
      metadata: {
        createdAt: "2026-08-23T00:00:00.000Z",
        jobId: 43,
        protocolMeta: { model: "agentworld-35b" },
      },
    };
    const second: ChatMessage = {
      ...assistantMessage([{ type: "text", text: "plain answer" }]),
      metadata: {
        createdAt: "2026-08-23T00:00:00.000Z",
        jobId: 44,
        protocolMeta: { model: "llama3-8b" },
      },
    };

    const doc = buildVerifiableTranscript({
      chatId: "chat-1",
      messages: [first, second],
    });

    expect(doc.messages[0].model).toBe("agentworld-35b");
    expect(doc.messages[1].model).toBe("llama3-8b");
  });

  it("falls back to protocolFinal text when no text parts are present", () => {
    const message = assistantMessage([
      { type: "data-protocolFinal", data: { text: "settled plaintext" } },
    ]);

    const doc = buildVerifiableTranscript({
      chatId: "chat-1",
      messages: [message],
    });

    expect(doc.messages[0].text).toBe("settled plaintext");
  });

  it("prefers streamed text parts over protocolFinal when both exist", () => {
    const message = assistantMessage([
      { type: "text", text: "streamed" },
      { type: "data-protocolFinal", data: { text: "settled" } },
    ]);

    const doc = buildVerifiableTranscript({
      chatId: "chat-1",
      messages: [message],
    });

    expect(doc.messages[0].text).toBe("streamed");
  });

  it("omits absent optional fields instead of writing undefined", () => {
    const message: ChatMessage = {
      id: "m-user",
      role: "user",
      metadata: { createdAt: "2026-08-23T00:00:00.000Z" },
      parts: [{ type: "text", text: "hi" }],
    };

    const doc = buildVerifiableTranscript({
      chatId: "chat-1",
      messages: [message],
    });
    const entry = doc.messages[0];

    expect(entry).toEqual({ role: "user", text: "hi" });
    expect("proof" in entry).toBe(false);
    expect("settlement" in entry).toBe(false);
    expect("reasoning" in entry).toBe(false);
    expect("jobId" in entry).toBe(false);
  });

  it("joins reasoning parts and carries the metadata jobId", () => {
    const message = assistantMessage([
      { type: "reasoning", text: "step one. " },
      { type: "reasoning", text: "step two." },
      { type: "text", text: "answer" },
    ]);

    const doc = buildVerifiableTranscript({
      chatId: "chat-1",
      messages: [message],
    });

    expect(doc.messages[0].reasoning).toBe("step one. step two.");
    expect(doc.messages[0].jobId).toBe(42);
  });

  it("round-trips through JSON unchanged (no bigint, no functions)", () => {
    const message = assistantMessage([
      { type: "text", text: "answer" },
      { type: "data-responseProof", data: proof },
      { type: "data-settlement", data: settlement },
    ]);

    const doc = buildVerifiableTranscript({
      chatId: "chat-1",
      title: "RT",
      messages: [message],
    });

    expect(JSON.parse(JSON.stringify(doc))).toEqual(doc);
  });

  it("builds a share payload from the proof plus live-session evidence", () => {
    const message = assistantMessage([
      { type: "text", text: "answer" },
      { type: "data-responseProof", data: proof },
    ]);

    const doc = buildVerifiableTranscript({
      chatId: "chat-1",
      messages: [message],
      evidence: new Map([
        [42, { ciphertext: "Y2lwaGVydGV4dA==", signature: "0xcccc" }],
      ]),
    });

    expect(doc.messages[0].share).toEqual({
      jobId: 42,
      sessionId: 7,
      ciphertext: "Y2lwaGVydGV4dA==",
      signature: "0xcccc",
      renderedText: "answer",
    });
  });

  it("omits the ciphertext when the live session no longer holds it", () => {
    const message = assistantMessage([
      { type: "text", text: "answer" },
      { type: "data-responseProof", data: proof },
    ]);

    const doc = buildVerifiableTranscript({
      chatId: "chat-1",
      messages: [message],
      evidence: new Map(),
    });

    const share = doc.messages[0].share;
    expect(share?.jobId).toBe(42);
    expect(share && "ciphertext" in share).toBe(false);
    // The persisted proof's own signature still rides along.
    expect(share?.signature).toBe("0xcccc");
  });

  it("adds no share payload to messages without a proof", () => {
    const message = assistantMessage([{ type: "text", text: "answer" }]);
    const doc = buildVerifiableTranscript({
      chatId: "chat-1",
      messages: [message],
    });
    expect(doc.messages[0].share).toBeUndefined();
  });

  it("ignores a responseProof part reloaded without a jobId", () => {
    // A persisted data part can come back as `data: {}` (e.g. a row written
    // before the field existed); it must not be mistaken for a real proof.
    const message = assistantMessage([
      { type: "text", text: "answer" },
      {
        type: "data-responseProof",
        data: {},
      } as ChatMessage["parts"][number],
    ]);
    const doc = buildVerifiableTranscript({
      chatId: "chat-1",
      messages: [message],
    });
    expect(doc.messages[0].proof).toBeUndefined();
    expect(doc.messages[0].share).toBeUndefined();
  });
});
