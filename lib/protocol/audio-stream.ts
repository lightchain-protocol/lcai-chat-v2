/**
 * Wire contract for the non-text frame kinds the worker now emits
 * (lightchain-worker 6ec92dc): `audio` chunks and `artifact` descriptors.
 *
 * Honesty boundary (bc-2-nontext-settlement.md §5, binding until the Phase-2
 * manifest commitment ships): nothing on these channels is settled on chain.
 * Every UI surface built on this module may say "Delivered" and must not say
 * "verified", "settled", or "provable". The `settled: false` field is part of
 * the wire format and is asserted on parse.
 */

/** Mirror of `audioMeta` in lightchain-worker/internal/pipeline/voice.go. */
export type AudioStreamDescriptor = {
  /** Header fields (first audio frame, before any PCM). */
  format: string; // "pcm-s16le"
  sampleRate: number; // 24000
  channels: number; // 1
  mime?: string;
  voice?: string;
  engine?: string; // "kokoro"
  chars?: number;
  truncated?: boolean;
  delivered: true;
  settled: false;
  /** Final fields (last audio frame; absent on a truncated stream). */
  final?: boolean;
  bytes?: number;
  chunks?: number;
  /** keccak256 of the delivered PCM, 0x-prefixed. Locally checkable. */
  contentHash?: string;
};

export type AudioFrame =
  | { kind: "meta"; meta: AudioStreamDescriptor }
  | { kind: "pcm"; pcm: Uint8Array };

/**
 * Classifies one decrypted `audio`-kind frame payload.
 *
 * The worker sends either raw PCM bytes or a JSON object carrying an
 * `audioMeta` key. It distinguishes them the same way we do here: a PCM s16le
 * chunk cannot be valid UTF-8 JSON with that key in practice, so JSON-parse
 * first and fall back to treating the bytes as audio.
 */
export function parseAudioFrame(bytes: Uint8Array): AudioFrame {
  if (bytes.length > 0 && bytes[0] === 0x7b) {
    // "{"
    try {
      const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Record<
        string,
        unknown
      >;
      const meta = parsed?.audioMeta as AudioStreamDescriptor | undefined;
      if (
        meta &&
        typeof meta.format === "string" &&
        typeof meta.sampleRate === "number"
      ) {
        return { kind: "meta", meta };
      }
    } catch {
      // Not JSON — fall through to PCM.
    }
  }
  return { kind: "pcm", pcm: bytes };
}

/** Mirror of `artifactDescriptor` in lightchain-worker/internal/pipeline/artifact.go. */
export type ArtifactDescriptor = {
  /** Producer family: "genui", "tool_call", "tool_result", ... */
  artifactType: string;
  /** Payload contract + version, e.g. "lightchain.genui.v1". */
  schema: string;
  payload: unknown;
  settled: false;
};

/**
 * Parses and validates an `artifact`-kind frame payload. Returns null for
 * anything malformed — a bad descriptor costs the user one card, never the
 * answer. Anything claiming `settled: true` is refused outright: the wire
 * contract pins it false, so a true here is a worker/relay lie, not a feature.
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
