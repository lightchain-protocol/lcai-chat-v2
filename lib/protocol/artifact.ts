/** Mirror of `artifactDescriptor` in lightchain-worker/internal/pipeline/artifact.go. */
export type ArtifactDescriptor = {
  /** Producer family: "genui", "tool_call", "tool_result", ... */
  artifactType: string;
  /** Payload contract + version, e.g. "lightchain.agent.tool_call.v1". */
  schema: string;
  payload: unknown;
  settled: false;
};

/** Artifacts are delivered, not settled: they never enter the settlement ciphertext. */
export const DELIVERED_NOT_SETTLED_LABEL =
  "Delivered · settles on-chain in an upcoming release";

/**
 * Parses and validates an `artifact`-kind frame payload. Returns null for
 * anything malformed — a bad descriptor costs the user one timeline step,
 * never the answer. Anything claiming `settled: true` is refused outright: the
 * wire contract pins it false, so a true here is a worker/relay lie.
 */
export function parseArtifactDescriptor(
  json: string
): ArtifactDescriptor | null {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (
    typeof parsed?.artifactType !== "string" ||
    parsed.artifactType.length === 0 ||
    typeof parsed.schema !== "string" ||
    parsed.schema.length === 0 ||
    parsed.payload === undefined ||
    parsed.settled === true
  ) {
    return null;
  }
  return {
    artifactType: parsed.artifactType,
    schema: parsed.schema,
    payload: parsed.payload,
    settled: false,
  };
}
