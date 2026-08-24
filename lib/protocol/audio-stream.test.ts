import { describe, expect, it } from "vitest";
import {
  type AudioStreamDescriptor,
  parseArtifactDescriptor,
  parseAudioFrame,
} from "./audio-stream";

const encoder = new TextEncoder();

const header: AudioStreamDescriptor = {
  format: "pcm-s16le",
  sampleRate: 24_000,
  channels: 1,
  mime: "audio/L16;rate=24000;channels=1",
  voice: "af_heart",
  engine: "kokoro",
  chars: 120,
  truncated: false,
  delivered: true,
  settled: false,
};

describe("parseAudioFrame", () => {
  it("parses a header descriptor frame", () => {
    const frame = parseAudioFrame(
      encoder.encode(JSON.stringify({ audioMeta: header }))
    );
    expect(frame.kind).toBe("meta");
    if (frame.kind === "meta") {
      expect(frame.meta.sampleRate).toBe(24_000);
      expect(frame.meta.settled).toBe(false);
      expect(frame.meta.final).toBeUndefined();
    }
  });

  it("parses a final descriptor frame with the content hash", () => {
    const frame = parseAudioFrame(
      encoder.encode(
        JSON.stringify({
          audioMeta: {
            ...header,
            final: true,
            bytes: 65_536,
            chunks: 2,
            contentHash: "0xabc123",
          },
        })
      )
    );
    expect(frame.kind).toBe("meta");
    if (frame.kind === "meta") {
      expect(frame.meta.final).toBe(true);
      expect(frame.meta.contentHash).toBe("0xabc123");
    }
  });

  it("treats non-JSON bytes as PCM", () => {
    const pcm = new Uint8Array([0x00, 0x01, 0xff, 0x7f, 0x42]);
    const frame = parseAudioFrame(pcm);
    expect(frame.kind).toBe("pcm");
    if (frame.kind === "pcm") {
      expect(Array.from(frame.pcm)).toEqual(Array.from(pcm));
    }
  });

  it("treats bytes starting with 0x7b but not parsing as PCM", () => {
    // Pathological PCM chunk whose first byte is '{' but which is not JSON.
    const pcm = new Uint8Array([0x7b, 0x00, 0x01, 0x02]);
    expect(parseAudioFrame(pcm).kind).toBe("pcm");
  });

  it("treats JSON without audioMeta as PCM (unknown future shape)", () => {
    const frame = parseAudioFrame(encoder.encode('{"other":1}'));
    expect(frame.kind).toBe("pcm");
  });
});

describe("parseArtifactDescriptor", () => {
  it("accepts a well-formed descriptor", () => {
    const d = parseArtifactDescriptor(
      JSON.stringify({
        artifactType: "genui",
        schema: "lightchain.genui.v1",
        payload: { rows: [] },
        settled: false,
      })
    );
    expect(d).toEqual({
      artifactType: "genui",
      schema: "lightchain.genui.v1",
      payload: { rows: [] },
      settled: false,
    });
  });

  it("refuses a descriptor claiming to be settled", () => {
    expect(
      parseArtifactDescriptor(
        JSON.stringify({
          artifactType: "genui",
          schema: "lightchain.genui.v1",
          payload: {},
          settled: true,
        })
      )
    ).toBeNull();
  });

  it("refuses missing/empty fields and bad JSON", () => {
    expect(parseArtifactDescriptor("not json")).toBeNull();
    expect(parseArtifactDescriptor("{}")).toBeNull();
    expect(
      parseArtifactDescriptor(
        JSON.stringify({ artifactType: "", schema: "s", payload: {} })
      )
    ).toBeNull();
    expect(
      parseArtifactDescriptor(
        JSON.stringify({ artifactType: "genui", schema: "lightchain.genui.v1" })
      )
    ).toBeNull();
  });
});
