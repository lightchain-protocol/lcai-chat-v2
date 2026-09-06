type MessageWithModelEvidence = {
  metadata?: {
    jobId?: number | null;
    groupId?: string | null;
    protocolMeta?: Record<string, unknown> | null;
  } | null;
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

/**
 * The per-turn group id of a multi-model sibling row, or undefined for an
 * ordinary single answer. Read from metadata.protocolMeta.groupId after a
 * reload, or the live data-protocolMeta part before the persist round trip —
 * the same dual-source rule as {@link servedModelIdFromMessage}. A top-level
 * metadata.groupId (set on live placeholder rows) is honored too.
 */
export function groupIdFromMessage(
  message: MessageWithModelEvidence
): string | undefined {
  const fromMeta = message.metadata?.protocolMeta?.groupId;
  if (typeof fromMeta === "string" && fromMeta.length > 0) {
    return fromMeta;
  }
  const topLevel = message.metadata?.groupId;
  if (typeof topLevel === "string" && topLevel.length > 0) {
    return topLevel;
  }
  for (const part of message.parts ?? []) {
    if (part.type !== "data-protocolMeta" || !part.data) {
      continue;
    }
    const groupId = (part.data as { groupId?: unknown }).groupId;
    if (typeof groupId === "string" && groupId.length > 0) {
      return groupId;
    }
  }
  return;
}

/**
 * The on-chain jobId a message is bound to, from metadata (reload) or the live
 * data-protocolMeta part (before persist). Feeds the per-column provenance chip.
 */
export function jobIdFromMessage(
  message: MessageWithModelEvidence
): number | undefined {
  const fromMeta = message.metadata?.jobId;
  if (typeof fromMeta === "number" && Number.isFinite(fromMeta)) {
    return fromMeta;
  }
  for (const part of message.parts ?? []) {
    if (part.type !== "data-protocolMeta" || !part.data) {
      continue;
    }
    const jobId = (part.data as { jobId?: unknown }).jobId;
    if (typeof jobId === "number" && Number.isFinite(jobId)) {
      return jobId;
    }
  }
  return;
}
