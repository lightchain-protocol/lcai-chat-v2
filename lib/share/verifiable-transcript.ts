import { isMaxModel } from "@/lib/ai/heat-tiers";
import type { GenerationStats } from "@/lib/protocol/relay-client";
import type { SettlementProgress } from "@/lib/protocol/settlement";
import type { StreamMetricsSnapshot } from "@/lib/protocol/stream-metrics";
import type { ResponseProof } from "@/lib/protocol/verify-response";
import type { ChatMessage } from "@/lib/types";
import type { SharedProofPayload } from "./verify-transcript";

/**
 * Shareable verifiable transcript — client-side export + self-contained
 * verifier (no server dependence).
 *
 * Product decision (owner-resolved 2026-08-23): sharing is EXPLICIT,
 * per-conversation consent — "Create public verifiable link" warns that the
 * conversation's content becomes public. No IPFS pin, no encryption: the
 * payload travels via URL hash or a downloaded .json file, and the verifier
 * page (app/share) re-verifies against the chain with a wallet-free public
 * client. The transcript contains only what the user already saw.
 *
 * Evidence availability: the full response ciphertext exists only in the
 * live session's memory (transport.mismatchEvidence — the same window as the
 * cryptographic dispute). Shares created in that window carry it and can
 * reach "Verified"; shares created after a reload omit it and the verifier
 * says "missing evidence" rather than overclaiming.
 *
 * Honesty notes (binding, see lightchain-agents/research/ai-3-nextgen-ux.md
 * and bc-2-duel-and-verifier-spec.md §2.4):
 * - The export proves nothing by itself; verification is recomputed at view
 *   time (recoverProofSigner-equivalent + chain reads) on the share page.
 * - renderedText is sharer-provided and NOT independently verifiable — the
 *   share page labels it exactly so.
 * - `settlement`/`streamMetrics` reflect what the sharer's client observed;
 *   non-text content (audio, artifacts) is delivered-not-settled and carries
 *   no provenance claim.
 */

export type VerifiableTranscriptMessage = {
  role: ChatMessage["role"];
  /** Rendered answer text; falls back to the settled protocolFinal text. */
  text: string;
  reasoning?: string;
  jobId?: number;
  /** Friendly catalogue id of the serving model, when the transport recorded it. */
  model?: string;
  /** "max" when the serving model id carries the -max tier suffix. */
  tier?: "max";
  proof?: ResponseProof;
  settlement?: SettlementProgress;
  generationStats?: GenerationStats;
  streamMetrics?: StreamMetricsSnapshot;
  /**
   * The verifier-page payload (bc-2 spec §2.1): ciphertext + signature when
   * the share is created in the live session that holds them, plus the
   * sharer-provided rendering. Omitted for messages without a proof.
   */
  share?: SharedProofPayload;
};

export type VerifiableTranscript = {
  v: 1;
  /** ISO timestamp of when this document was built. */
  exportedAt: string;
  chat: { id: string; title?: string };
  messages: VerifiableTranscriptMessage[];
};

type BuildInput = {
  chatId: string;
  title?: string;
  messages: ChatMessage[];
  /**
   * Live-session evidence keyed by jobId (base64 ciphertext + signature from
   * the terminal frame). Only available before reload — shares created later
   * simply omit the ciphertext and verify as "missing evidence".
   */
  evidence?: ReadonlyMap<
    number,
    { ciphertext: string; signature?: string | null }
  >;
  /** Clock injection for tests; production uses Date.now. */
  now?: () => number;
};

function joinParts(
  message: ChatMessage,
  type: "text" | "reasoning"
): string | undefined {
  const chunks: string[] = [];
  for (const part of message.parts) {
    if (part.type === type && part.text) {
      chunks.push(part.text);
    }
  }
  const joined = chunks.join("");
  return joined.length > 0 ? joined : undefined;
}

export function buildVerifiableTranscript({
  chatId,
  title,
  messages,
  evidence,
  now = () => Date.now(),
}: BuildInput): VerifiableTranscript {
  const out: VerifiableTranscriptMessage[] = messages.map((message) => {
    const entry: VerifiableTranscriptMessage = {
      role: message.role,
      text: "",
    };

    const text = joinParts(message, "text");
    if (text !== undefined) {
      entry.text = text;
    }

    const reasoning = joinParts(message, "reasoning");
    if (reasoning !== undefined) {
      entry.reasoning = reasoning;
    }

    const jobId = message.metadata?.jobId;
    if (typeof jobId === "number") {
      entry.jobId = jobId;
    }

    const servedModel = message.metadata?.protocolMeta?.model;
    if (typeof servedModel === "string") {
      entry.model = servedModel;
      if (isMaxModel(servedModel)) {
        entry.tier = "max";
      }
    }

    for (const part of message.parts) {
      if (part.type === "data-protocolFinal" && part.data) {
        // Authoritative settled plaintext: only used when the streamed text
        // parts are absent (e.g. a message restored from the wire format).
        if (entry.text.length === 0 && part.data.text) {
          entry.text = part.data.text;
        }
      } else if (part.type === "data-responseProof" && part.data) {
        entry.proof = part.data;
      } else if (part.type === "data-settlement" && part.data) {
        entry.settlement = part.data;
      } else if (part.type === "data-generationStats" && part.data) {
        entry.generationStats = part.data;
      } else if (part.type === "data-streamMetrics" && part.data) {
        entry.streamMetrics = part.data;
      }
    }

    // Share payload for the public verifier. Only assistant messages with a
    // persisted proof get one; the ciphertext rides along only when the live
    // session still holds it (the same window as the cryptographic dispute).
    if (entry.proof) {
      const live = evidence?.get(entry.proof.jobId);
      entry.share = {
        jobId: entry.proof.jobId,
        sessionId: entry.proof.sessionId,
        ...(live?.ciphertext ? { ciphertext: live.ciphertext } : {}),
        ...(live?.signature || entry.proof.signature
          ? {
              signature: (live?.signature ??
                entry.proof.signature) as SharedProofPayload["signature"],
            }
          : {}),
        ...(entry.text ? { renderedText: entry.text } : {}),
      };
    }

    return entry;
  });

  return {
    v: 1,
    exportedAt: new Date(now()).toISOString(),
    chat: { id: chatId, ...(title ? { title } : {}) },
    messages: out,
  };
}
