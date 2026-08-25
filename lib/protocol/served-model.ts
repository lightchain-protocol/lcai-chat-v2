type MessageWithModelEvidence = {
  metadata?: { protocolMeta?: Record<string, unknown> | null } | null;
  parts?: Array<{ type: string; data?: unknown }>;
};

/**
 * The id of the model that served a message. Live messages carry it on the
 * data-protocolMeta part emitted at first frame; reloaded ones also have it on
 * metadata.protocolMeta. Metadata wins when both exist — it is the record the
 * API stored.
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
