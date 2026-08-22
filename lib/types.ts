import type { InferUITool, UIMessage } from "ai";
import { z } from "zod";
import type { getWeather } from "./ai/tools/get-weather";
import type { webSearch } from "./ai/tools/web-search";
import type { GenerationStats } from "./protocol/relay-client";
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
  | "preparing_chat"
  | "writing_on_chain"
  | "searching_web"
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
  preparing_chat: "Preparing your chat...",
  writing_on_chain: "Writing on chain...",
  searching_web: "Searching the web...",
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
  // What the model itself measured for the generation. Arrives on its own
  // frame kind from the worker rather than being inferred client-side.
  generationStats: GenerationStats;
  // Verification evidence captured from the terminal frame, so the answer can
  // be checked against the chain long after it was received.
  responseProof: ResponseProof;
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
