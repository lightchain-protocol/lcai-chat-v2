import { baseModelId, isMaxModel, toMaxModelId, type HeatTier } from "./heat-tiers";

export const DEFAULT_CHAT_MODEL: string = "llama3-8b";

export type ChatModel = {
  id: string;
  name: string;
  description: string;
  fee: number;
  maxOutputTokens: number;
};

// === BEGIN HAND-WRITTEN HELPERS (preserved across regen by 16-gen-models-ts.mjs — edit freely in lcai-chat-v2, this block is carried forward verbatim) ===
/**
 * Models that can actually read an image.
 *
 * Sending image data to a text-only model wastes blob space the consumer pays
 * for and produces a confused answer, so the composer only offers attachments
 * when one of these is selected.
 */
const VISION_MODEL_IDS = new Set(["qwen3-vl-8b"]);

export function modelSupportsImages(modelId: string | undefined): boolean {
  return modelId !== undefined && VISION_MODEL_IDS.has(baseModelId(modelId));
}

/**
 * Models whose serving worker runs the whisper (STT) and Kokoro (TTS) voice
 * sidecars. Today that is worker-3's set (A100, sidecars on loopback
 * 8100/8101 — provisioning/worker/voice-sidecars.md and
 * provisioning/residency-contract.json).
 *
 * Workers do not advertise voice in their heartbeat capabilities yet, so the
 * signal lives here, mirroring modelSupportsImages. When heartbeat
 * advertisement lands this should merge with useModelCapabilities rather
 * than trusting a static list.
 */
const VOICE_MODEL_IDS = new Set([
  "gpt-oss-20b",
  "qwen3-coder-30b",
  "devstral-24b",
]);

export function modelSupportsVoice(modelId: string | undefined): boolean {
  return modelId !== undefined && VOICE_MODEL_IDS.has(baseModelId(modelId));
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
  return MODEL_TRAITS[baseModelId(modelId)]?.specialty ?? "General";
}

export function modelSpeed(modelId: string): ModelSpeed {
  return MODEL_TRAITS[baseModelId(modelId)]?.speed ?? "Balanced";
}

/**
 * Tier availability is read off the catalogue, never assumed: a model offers
 * Max only when its `{id}-max` entry is actually present.
 */
export function hasMaxVariant(
  modelId: string,
  models: ChatModel[] = chatModels
): boolean {
  return models.some((m) => m.id === toMaxModelId(baseModelId(modelId)));
}

/** Used by the Auto route, where the base model isn't known until send. */
export function hasAnyMaxVariant(models: ChatModel[] = chatModels): boolean {
  return models.some((m) => isMaxModel(m.id));
}

/**
 * What actually gets sent for (model, tier). Falls back to the base id when
 * the catalogue has no Max entry, so arming Max can never produce an id the
 * network doesn't know.
 */
export function resolveTierModelId(
  modelId: string,
  tier: HeatTier,
  models: ChatModel[] = chatModels
): string {
  if (tier !== "max") {
    return baseModelId(modelId);
  }
  const base = baseModelId(modelId);
  return hasMaxVariant(base, models) ? toMaxModelId(base) : base;
}

/**
 * Display names for Max aliases (tier-catalog frontend note): proper-cased
 * base name + " Max", one mapping line per alias — the catalogue `name` field
 * is the lowercase id, which reads badly next to a fee.
 */
const DISPLAY_NAME_OVERRIDES: Record<string, string> = {
  "agentworld-35b-max": "AgentWorld 35B Max",
  "gpt-oss-20b-max": "GPT-OSS 20B Max",
};

export function displayName(model: ChatModel): string {
  return DISPLAY_NAME_OVERRIDES[model.id] ?? model.name;
}

/**
 * The fee the picker/preview should quote for (model, tier): the Max entry's
 * own fee when armed and present, the base fee otherwise. Never hardcoded —
 * always read off the catalogue entry that will actually be charged.
 */
export function effectiveFee(
  modelId: string,
  tier: HeatTier,
  models: ChatModel[] = chatModels
): number | undefined {
  const resolved = resolveTierModelId(modelId, tier, models);
  return models.find((m) => m.id === resolved)?.fee;
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
// === END HAND-WRITTEN HELPERS ===

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
    id: "gpt-oss-20b-max",
    name: "gpt-oss-20b-max",
    fee: 0.1,
    maxOutputTokens: 6144,
    description:
      "GPT-OSS 20B Max is the Max tier of GPT-OSS 20b — same model, higher output budget (6144 tokens) for longer, more complete answers.",
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
    maxOutputTokens: 3000,
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
    id: "agentworld-35b-max",
    name: "agentworld-35b-max",
    fee: 0.2,
    maxOutputTokens: 8192,
    description:
      "AgentWorld 35B Max is the Max tier of AgentWorld 35b — same agentic model, full 8192-token output budget for demanding multi-step runs.",
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
