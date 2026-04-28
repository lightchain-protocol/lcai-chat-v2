import type { InferUITool, UIMessage } from "ai";
import { z } from "zod";
import type { getWeather } from "./ai/tools/get-weather";
import type { webSearch } from "./ai/tools/web-search";
import type { AppUsage } from "./usage";

export type DataPart = { type: "append-message"; message: string };

export const messageMetadataSchema = z.object({
  createdAt: z.string(),
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
  submitting_job: "Uploading prompt to chain...",
  waiting_for_relay: "Thinking...",
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
