import type { GenerationStats } from "@/lib/protocol/relay-client";
import type { SettlementProgress } from "@/lib/protocol/settlement";
import type { StreamMetricsSnapshot } from "@/lib/protocol/stream-metrics";
import type { ResponseProof } from "@/lib/protocol/verify-response";
import type { ChatMessage } from "@/lib/types";

/**
 * Shareable verifiable transcript — WAVE-3 SCAFFOLD (pure builder, UNWIRED).
 *
 * This module only knows how to fold a chat's persisted message parts into a
 * portable JSON document. Nothing calls it yet. Remaining wiring, in order:
 *
 * TODO(1) Server route `POST /api/chat/export` that pins the built JSON via
 *         the existing `uploadToIPFS` helper (lib/utils/ipfs-helpers.ts).
 *         OPEN PRODUCT DECISION: the current backup flow encrypts the payload
 *         with a wallet-address-derived AES-GCM key before pinning, which is
 *         right for private backups but makes the CID useless to anyone
 *         without the owner's wallet. The design doc's §3.4 public
 *         "verifiable view" link needs a PLAINTEXT pin instead (the transcript
 *         contains no secrets — only what the user already saw — and the whole
 *         point is that a third party can re-verify it). Pick one: a second,
 *         unencrypted pin path for shares, or keep shares encrypted and drop
 *         the public-link goal.
 * TODO(2) Public route `/share/[cid]` that fetches the document and
 *         RE-VERIFIES it client-side: `recoverProofSigner` +
 *         `checkProofAgainstChain` + `fetchOnChainJob` per message. The export
 *         itself proves nothing — it only carries the evidence captured at
 *         receipt (honesty rule: verification is recomputed at view time,
 *         never inherited from the exported file).
 * TODO(3) UI: an export affordance (chat header / message actions) that calls
 *         the route and copies the resulting CID link.
 *
 * Honesty notes (binding, see lightchain-agents/research/ai-3-nextgen-ux.md):
 * - `settlement` reflects what this client observed at the time, including its
 *   `acknowledgedOnChain`/`settledOnChainSec` distinctions. The share viewer
 *   must present those with the same wording as the in-app timeline.
 * - `streamMetrics` tok/s values are browser estimates (chars/4); the worker's
 *   measured numbers live in `generationStats`. Do not silently upgrade one
 *   into the other when rendering a share.
 */

export type VerifiableTranscriptMessage = {
  role: ChatMessage["role"];
  /** Rendered answer text; falls back to the settled protocolFinal text. */
  text: string;
  reasoning?: string;
  jobId?: number;
  proof?: ResponseProof;
  settlement?: SettlementProgress;
  generationStats?: GenerationStats;
  streamMetrics?: StreamMetricsSnapshot;
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

    return entry;
  });

  return {
    v: 1,
    exportedAt: new Date(now()).toISOString(),
    chat: { id: chatId, ...(title ? { title } : {}) },
    messages: out,
  };
}
