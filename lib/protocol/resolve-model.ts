/**
 * Turning whatever the composer is holding into an on-chain model id.
 *
 * Live models are keyed by hex id, but a selection does not always start that
 * way. `DEFAULT_CHAT_MODEL` is the legacy NAME ("llama3-8b"), a first visit has
 * no `chat-model` cookie so the page renders with that name, and a cookie
 * written before the live picker landed holds one too. `components/chat.tsx`
 * swaps the name for the real id once `/api/models` resolves — but the composer
 * is usable before that, so a fast sender reaches the send path holding a name.
 *
 * Kept out of the hook so it can be tested in node: no React, no transport.
 */

export type ResolvableModel = { id: string; name: string };

/** An on-chain model id: 0x + 32 bytes. */
const HEX_MODEL_ID = /^0x[0-9a-f]{64}$/i;

export function isHexModelId(value: string): boolean {
  return HEX_MODEL_ID.test(value);
}

/**
 * Resolve a selection against the models the gateway is serving.
 *
 * Matches on id first, then — only for a selection that is not already an id —
 * on name. A hex id absent from the list is NOT name-matched: it is an id for
 * something this network does not serve, and guessing a different model from it
 * would silently send the prompt somewhere the user did not choose.
 *
 * Returns undefined when nothing matches, so callers decide how to report it;
 * this has no worker data and must not claim anything about availability.
 */
export function resolveModelSelection<T extends ResolvableModel>(
  selection: string,
  models: readonly T[]
): T | undefined {
  if (models.length === 0) {
    return;
  }

  const lowered = selection.toLowerCase();
  const byId = models.find((model) => model.id.toLowerCase() === lowered);
  if (byId) {
    return byId;
  }

  if (isHexModelId(selection)) {
    return;
  }

  return models.find((model) => model.name === selection);
}
