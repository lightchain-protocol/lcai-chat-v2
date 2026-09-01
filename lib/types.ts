import type { InferUITool, UIMessage } from "ai";
import { z } from "zod";
import type { getWeather } from "./ai/tools/get-weather";
import type { webSearch } from "./ai/tools/web-search";
import type { ArtifactDescriptor } from "./protocol/artifact";
import type { GenerationStats } from "./protocol/relay-client";
import type { SettlementProgress } from "./protocol/settlement";
import type { StreamMetricsSnapshot } from "./protocol/stream-metrics";
import type { ResponseProof } from "./protocol/verify-response";
import type { AppUsage } from "./usage";

export type DataPart = { type: "append-message"; message: string };

export type WebSearchSource = {
  position: number;
  title: string;
  url: string;
  description: string;
};

export const messageMetadataSchema = z.object({
  createdAt: z.string(),
  jobId: z.number().int().optional(),
  // Per-turn id shared by the N sibling assistant rows of a multi-model send.
  // The load-bearing copy is carried inside protocolMeta (persisted + rehydrated
  // by convertToUIMessages); this top-level field mirrors it for convenience.
  groupId: z.string().optional(),
  protocolMeta: z.record(z.string(), z.unknown()).optional(),
});

export type MessageMetadata = z.infer<typeof messageMetadataSchema>;

type weatherTool = InferUITool<typeof getWeather>;
type webSearchTool = InferUITool<typeof webSearch>;

export type ChatTools = {
  getWeather: weatherTool;
  webSearch: webSearchTool;
};

export type ProtocolLoadingStatus =
  | "idle"
  | "finding_worker"
  | "preparing_chat"
  | "writing_on_chain"
  | "submitting_job"
  | "waiting_for_relay"
  | "decoding_prompt"
  | "thinking"
  | "reasoning"
  | "streaming"
  | "completed"
  | "error";

export const PROTOCOL_LOADING_STATUS_LABELS: Record<
  ProtocolLoadingStatus,
  string
> = {
  idle: "Thinking...",
  finding_worker: "Finding a worker...",
  preparing_chat: "Preparing your chat...",
  writing_on_chain: "Writing on chain...",
  submitting_job: "Uploading prompt to chain...",
  // The longest wait in the whole flow: the worker has the job and is loading
  // the model. A cold one takes over ten seconds, so this says what is
  // happening rather than leaving a generic spinner.
  waiting_for_relay: "Waiting for the worker...",
  decoding_prompt: "Decoding your prompt",
  thinking: "Thinking...",
  reasoning: "Reasoning...",
  streaming: "Reasoning...",
  completed: "Thinking...",
  error: "Thinking...",
};

export type CustomUIDataTypes = {
  textDelta: string;
  imageDelta: string;
  sheetDelta: string;
  codeDelta: string;
  appendMessage: string;
  id: string;
  title: string;
  clear: null;
  finish: null;
  usage: AppUsage;
  webSearchSources: { sources: WebSearchSource[] };
  protocolFinal: { text: string };
  // The job's protocol record (jobId, sessionId, serving model id). Emitted
  // live at first frame — the row's metadata.protocolMeta only exists after
  // the persist round trip — and persisted with the message so live and
  // reload views match.
  protocolMeta: {
    jobId: number;
    sessionId: number;
    correlationId?: string;
    completedAt?: string;
    model?: string;
    // Set only on the sibling rows of a multi-model turn, so a reloaded chat
    // reassembles them into columns. Absent on ordinary single-model answers.
    groupId?: string;
  };
  // What the model itself measured for the generation. Arrives on its own
  // frame kind from the worker rather than being inferred client-side.
  generationStats: GenerationStats;
  // Verification evidence captured from the terminal frame, so the answer can
  // be checked against the chain long after it was received.
  responseProof: ResponseProof;
  // The answer's on-chain journey (escrow → ack → stream → settle), updated
  // live during the job and persisted in its final form with the message.
  // Verification is deliberately not part of this record — it is recomputed
  // from responseProof at render time.
  settlement: SettlementProgress;
  // Browser-measured timing (TTFT, rolling throughput estimate). The worker's
  // own numbers live in generationStats; these cover the wait before them.
  streamMetrics: StreamMetricsSnapshot;
  // One artifact descriptor per artifact frame (unique ids). Persisted with
  // the message; agent schemas render in the timeline, others are ignored.
  artifact: ArtifactDescriptor;
};

export type ChatMessage = UIMessage<
  MessageMetadata,
  CustomUIDataTypes,
  ChatTools
>;

export type Attachment = {
  name: string;
  url: string;
  contentType: string;
};
