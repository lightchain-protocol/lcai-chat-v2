export const DEFAULT_CHAT_MODEL: string = "llama3-8b";

export type ChatModel = {
  id: string;
  name: string;
  description: string;
  fee: number;
  maxOutputTokens: number;
};

/**
 * Models that can actually read an image.
 *
 * Sending image data to a text-only model wastes blob space the consumer pays
 * for and produces a confused answer, so the composer only offers attachments
 * when one of these is selected.
 */
const VISION_MODEL_IDS = new Set(["qwen3-vl-8b"]);

export function modelSupportsImages(modelId: string | undefined): boolean {
  return modelId !== undefined && VISION_MODEL_IDS.has(modelId);
}

export function getChatModel(
  modelId: string | undefined
): ChatModel | undefined {
  return chatModels.find((m) => m.id === modelId);
}

/**
 * What a model is for. Seventeen models in one flat list is unusable — an
 * earlier attempt to show descriptions inline made the list run off the bottom
 * of the viewport — so the picker groups by this instead.
 */
export type ModelSpecialty =
  | "General"
  | "Coding"
  | "Reasoning"
  | "Vision"
  | "Agentic";

/**
 * Rough response speed, taken from the fleet latency measurements.
 *
 * The 8B models answer in well under a second; the 30B+ models generate at
 * roughly 40 tok/s, so a long reply takes real time. Users choose differently
 * when they can see which is which.
 */
export type ModelSpeed = "Fast" | "Balanced" | "Deliberate";

const MODEL_TRAITS: Record<
  string,
  { specialty: ModelSpecialty; speed: ModelSpeed }
> = {
  "llama3-8b": { specialty: "General", speed: "Fast" },
  "qwen3-8b": { specialty: "General", speed: "Fast" },
  "lfm2.5-8b": { specialty: "General", speed: "Fast" },
  "gemma4-12b": { specialty: "General", speed: "Fast" },
  "glm-4.7-flash": { specialty: "General", speed: "Fast" },
  "qwen3-vl-8b": { specialty: "Vision", speed: "Balanced" },
  "gpt-oss-20b": { specialty: "General", speed: "Balanced" },
  "mistral-small-24b": { specialty: "General", speed: "Balanced" },
  "gemma4-26b": { specialty: "General", speed: "Balanced" },
  "qwen3.6-27b": { specialty: "General", speed: "Balanced" },
  "qwen3.8-27b": { specialty: "General", speed: "Balanced" },
  "qwen3-coder-30b": { specialty: "Coding", speed: "Balanced" },
  "devstral-24b": { specialty: "Coding", speed: "Balanced" },
  "kat-coder-32b": { specialty: "Coding", speed: "Deliberate" },
  "deepseek-r1-32b": { specialty: "Reasoning", speed: "Deliberate" },
  "ornith-1.5-35b": { specialty: "Reasoning", speed: "Deliberate" },
  "agentworld-35b": { specialty: "Agentic", speed: "Deliberate" },
};

export function modelSpecialty(modelId: string): ModelSpecialty {
  return MODEL_TRAITS[modelId]?.specialty ?? "General";
}

export function modelSpeed(modelId: string): ModelSpeed {
  return MODEL_TRAITS[modelId]?.speed ?? "Balanced";
}

/** Display order for the grouped picker: everyday choices first. */
export const SPECIALTY_ORDER: ModelSpecialty[] = [
  "General",
  "Coding",
  "Reasoning",
  "Vision",
  "Agentic",
];

export function groupModelsBySpecialty(
  models: ChatModel[] = chatModels
): Array<{ specialty: ModelSpecialty; models: ChatModel[] }> {
  return SPECIALTY_ORDER.map((specialty) => ({
    specialty,
    models: models.filter((m) => modelSpecialty(m.id) === specialty),
  })).filter((group) => group.models.length > 0);
}

/** Formats a per-job fee for display. Fees are small, so trailing zeros go. */
export function formatFee(fee: number): string {
  return `${Number.parseFloat(fee.toFixed(4))} LCAI`;
}

const STARTERS_BY_SPECIALTY: Record<ModelSpecialty, string[]> = {
  General: [
    "Explain how this network pays for inference",
    "Summarize the tradeoffs of proof of stake",
    "Draft a short update to my team",
  ],
  Coding: [
    "Review this function for edge cases",
    "Write a migration script with a rollback",
    "Explain this stack trace",
  ],
  Reasoning: [
    "Work through this problem step by step",
    "Find the flaw in this argument",
    "Compare these two designs on cost and risk",
  ],
  Vision: [
    "Describe what is in this image",
    "Read the text out of this screenshot",
    "What is wrong with this chart?",
  ],
  Agentic: [
    "Plan the steps to migrate a database",
    "Break this task into ordered subtasks",
    "What would you check first to debug this?",
  ],
};

/**
 * Example prompts for the empty state, matched to what the selected model is
 * good at. Suggesting "describe this image" next to a text-only model would
 * cost the user a job fee to learn it cannot.
 */
export function starterPrompts(modelId: string | undefined): string[] {
  return STARTERS_BY_SPECIALTY[modelId ? modelSpecialty(modelId) : "General"];
}

// Kept in sync with the models registered + enabled on AIConfig that have a
// live, on-chain-eligible worker. Every entry is whitelisted on WorkerRegistry
// and has at least one eligible worker; fees come from AIConfig.calculateJobFee
// and maxOutputTokens from AIConfig.getModelMaxOutputTokens.
// Regenerate with provisioning/rebuild/models/16-gen-models-ts.mjs.
export const chatModels: ChatModel[] = [
  {
    id: "llama3-8b",
    name: "llama3-8b",
    fee: 0.001,
    maxOutputTokens: 4096,
    description:
      "Llama3-8b is a general-purpose model for questions and everyday tasks, served by the Lightchain worker network.",
  },
  {
    id: "qwen3-8b",
    name: "qwen3-8b",
    fee: 0.02,
    maxOutputTokens: 2048,
    description:
      "Qwen3 8b is a fast general-purpose model, a good default for short conversational turns.",
  },
  {
    id: "qwen3-vl-8b",
    name: "qwen3-vl-8b",
    fee: 0.02,
    maxOutputTokens: 2048,
    description:
      "Qwen3-VL 8b is a vision-language model that can read and reason about images alongside text.",
  },
  {
    id: "gemma4-12b",
    name: "gemma4-12b",
    fee: 0.02,
    maxOutputTokens: 2048,
    description:
      "Gemma4 12b is a mid-sized general-purpose model balancing quality against response time.",
  },
  {
    id: "gpt-oss-20b",
    name: "gpt-oss-20b",
    fee: 0.05,
    maxOutputTokens: 4096,
    description:
      "GPT-OSS 20b is an open-weight general-purpose model for chat and reasoning tasks.",
  },
  {
    id: "qwen3-coder-30b",
    name: "qwen3-coder-30b",
    fee: 0.05,
    maxOutputTokens: 4096,
    description:
      "Qwen3-Coder 30b is the larger coding model, suited to bigger refactors and whole-file generation.",
  },
  {
    id: "glm-4.7-flash",
    name: "glm-4.7-flash",
    fee: 0.05,
    maxOutputTokens: 4096,
    description:
      "GLM 4.7 Flash is tuned for low latency, for quick answers where speed matters most.",
  },
  {
    id: "devstral-24b",
    name: "devstral-24b",
    fee: 0.05,
    maxOutputTokens: 4096,
    description:
      "Devstral 24b is a software-engineering model aimed at codebase-level tasks and tool use.",
  },
  {
    id: "deepseek-r1-32b",
    name: "deepseek-r1-32b",
    fee: 0.05,
    maxOutputTokens: 4096,
    description:
      "DeepSeek-R1 32b is the larger reasoning model, for harder multi-step problems where depth matters more than speed.",
  },
  {
    id: "qwen3.6-27b",
    name: "qwen3.6-27b",
    fee: 0.05,
    maxOutputTokens: 4096,
    description:
      "Qwen3.6 27b is a strong general-purpose model for longer, more involved responses.",
  },
  {
    id: "gemma4-26b",
    name: "gemma4-26b",
    fee: 0.05,
    maxOutputTokens: 4096,
    description:
      "Gemma4 26b is the larger Gemma model, for richer writing and analysis tasks.",
  },
  {
    id: "mistral-small-24b",
    name: "mistral-small-24b",
    fee: 0.05,
    maxOutputTokens: 4096,
    description:
      "Mistral Small 24b is a balanced general-purpose model with strong instruction following.",
  },
  {
    id: "qwen3.8-27b",
    name: "qwen3.8-27b",
    fee: 0.05,
    maxOutputTokens: 4096,
    description:
      "Qwen3.8 27b is the newest Qwen generation, a dense multimodal model for long-context reading and analysis.",
  },
  {
    id: "ornith-1.5-35b",
    name: "ornith-1.5-35b",
    fee: 0.05,
    maxOutputTokens: 4096,
    description:
      "Ornith 1.5 35b is a mixture-of-experts reasoning model with vision, for demanding multi-step analysis.",
  },
  {
    id: "agentworld-35b",
    name: "agentworld-35b",
    fee: 0.05,
    maxOutputTokens: 4096,
    description:
      "AgentWorld 35b is a mixture-of-experts model built for agentic planning and environment simulation.",
  },
  {
    id: "kat-coder-32b",
    name: "kat-coder-32b",
    fee: 0.05,
    maxOutputTokens: 4096,
    description:
      "KAT-Coder 32b is an agentic coding model for multi-file changes and tool-driven development.",
  },
  {
    id: "lfm2.5-8b",
    name: "lfm2.5-8b",
    fee: 0.02,
    maxOutputTokens: 2048,
    description:
      "LFM2.5 8b is a fast hybrid-architecture model from Liquid AI, strong at multilingual everyday tasks.",
  },
];
