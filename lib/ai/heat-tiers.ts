/**
 * Heat tiers — the "Standard | Max" quality knob.
 *
 * A Max variant of a model is registered on chain (and in the generated
 * catalogue) as a separate model whose id is `{baseModelId}-max`
 * (provisioning/tier-catalog.json, AI-2). The UI never hardcodes which models
 * have a Max tier: it derives availability from the model list itself, so a
 * catalogue with no `-max` entries makes every Max control a visible no-op
 * rather than a promise the network can't keep.
 *
 * The gateway resolves models by name substring (use-protocol-session
 * resolveModelId), so the suffixed id needs no special handling on the send
 * path — it just has to exist in the catalogue.
 */

export type HeatTier = "standard" | "max";

export const MAX_TIER_SUFFIX = "-max";

export function isMaxModel(modelId: string): boolean {
  return modelId.endsWith(MAX_TIER_SUFFIX);
}

export function toMaxModelId(baseId: string): string {
  return `${baseId}${MAX_TIER_SUFFIX}`;
}

/** Base id when the suffix is present, null otherwise. */
export function fromMaxModelId(modelId: string): string | null {
  return isMaxModel(modelId) ? modelId.slice(0, -MAX_TIER_SUFFIX.length) : null;
}

/** The id without its tier suffix — traits/capabilities key off this. */
export function baseModelId(modelId: string): string {
  return fromMaxModelId(modelId) ?? modelId;
}

export function tierOfModelId(modelId: string): HeatTier {
  return isMaxModel(modelId) ? "max" : "standard";
}

/**
 * Structural minimum of a chat message for tier labelling — both ChatMessage
 * and the transcript builder's entries satisfy it.
 */
type MessageWithModelEvidence = {
  metadata?: { protocolMeta?: Record<string, unknown> | null } | null;
  parts?: Array<{ type: string; data?: unknown }>;
};

/**
 * The friendly catalogue id of the model that served a message
 * ("agentworld-35b-max"). Live messages carry it on the data-protocolMeta
 * part emitted at first frame; reloaded ones also have it on
 * metadata.protocolMeta. Metadata wins when both exist — it is the record
 * the API stored.
 */
export function servedModelIdFromMessage(
  message: MessageWithModelEvidence
): string | undefined {
  const fromMeta = message.metadata?.protocolMeta?.model;
  if (typeof fromMeta === "string" && fromMeta.length > 0) {
    return fromMeta;
  }
  for (const part of message.parts ?? []) {
    if (part.type !== "data-protocolMeta" || !part.data) {
      continue;
    }
    const model = (part.data as { model?: unknown }).model;
    if (typeof model === "string" && model.length > 0) {
      return model;
    }
  }
  return;
}
