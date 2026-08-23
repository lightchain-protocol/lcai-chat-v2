import { describe, expect, it } from "vitest";
import {
  base64DecodedBytes,
  encodeWavMonoS16le,
  float32ToS16leBytes,
  MAX_PROMPT_AUDIO_BYTES,
  MAX_VOICE_CLIP_SECONDS,
  s16leBytesToFloat32,
  VOICE_PROMPT_SAMPLE_RATE,
} from "./pcm";

describe("s16leBytesToFloat32 / float32ToS16leBytes", () => {
  it("round-trips representative samples", () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1, -1]);
    const bytes = float32ToS16leBytes(samples);
    const back = s16leBytesToFloat32(bytes);
    expect(back.length).toBe(samples.length);
    for (let i = 0; i < samples.length; i++) {
      expect(back[i]).toBeCloseTo(samples[i], 3);
    }
  });

  it("encodes little-endian (0x0100 = 256)", () => {
    const bytes = float32ToS16leBytes(new Float32Array([256 / 32_768]));
    expect(bytes[0]).toBe(0x00);
    expect(bytes[1]).toBe(0x01);
  });

  it("maps -1 to -32768 and +1 to +32767", () => {
    const bytes = float32ToS16leBytes(new Float32Array([-1, 1]));
    const view = new DataView(bytes.buffer);
    expect(view.getInt16(0, true)).toBe(-32_768);
    expect(view.getInt16(2, true)).toBe(32_767);
  });

  it("clamps out-of-range floats instead of wrapping", () => {
    const bytes = float32ToS16leBytes(new Float32Array([2, -2]));
    const view = new DataView(bytes.buffer);
    expect(view.getInt16(0, true)).toBe(32_767);
    expect(view.getInt16(2, true)).toBe(-32_768);
  });

  it("ignores a trailing odd byte", () => {
    const back = s16leBytesToFloat32(new Uint8Array([1, 0, 2]));
    expect(back.length).toBe(1);
  });
});

describe("encodeWavMonoS16le", () => {
  it("writes a canonical 44-byte header", () => {
    const samples = new Float32Array(VOICE_PROMPT_SAMPLE_RATE); // 1 s
    const wav = encodeWavMonoS16le(samples, VOICE_PROMPT_SAMPLE_RATE);
    const view = new DataView(wav.buffer);

    expect(wav.length).toBe(44 + VOICE_PROMPT_SAMPLE_RATE * 2);
    const ascii = (off: number, len: number) =>
      String.fromCharCode(...wav.subarray(off, off + len));
    expect(ascii(0, 4)).toBe("RIFF");
    expect(view.getUint32(4, true)).toBe(wav.length - 8);
    expect(ascii(8, 4)).toBe("WAVE");
    expect(ascii(12, 4)).toBe("fmt ");
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(VOICE_PROMPT_SAMPLE_RATE);
    expect(view.getUint32(28, true)).toBe(VOICE_PROMPT_SAMPLE_RATE * 2);
    expect(view.getUint16(34, true)).toBe(16);
    expect(ascii(36, 4)).toBe("data");
    expect(view.getUint32(40, true)).toBe(VOICE_PROMPT_SAMPLE_RATE * 2);
  });

  it("keeps a max-length clip inside the worker's base64 budget", () => {
    const samples = new Float32Array(
      MAX_VOICE_CLIP_SECONDS * VOICE_PROMPT_SAMPLE_RATE
    );
    const wav = encodeWavMonoS16le(samples, VOICE_PROMPT_SAMPLE_RATE);
    expect(wav.length).toBeLessThanOrEqual(MAX_PROMPT_AUDIO_BYTES);
    // Base64 inflates by 4/3; the worker caps the encoded form.
    expect(Math.ceil(wav.length / 3) * 4).toBeLessThanOrEqual(131_072);
  });

  it("one second over the cap would exceed the budget", () => {
    const samples = new Float32Array(
      (MAX_VOICE_CLIP_SECONDS + 1) * VOICE_PROMPT_SAMPLE_RATE
    );
    const wav = encodeWavMonoS16le(samples, VOICE_PROMPT_SAMPLE_RATE);
    expect(wav.length).toBeGreaterThan(MAX_PROMPT_AUDIO_BYTES);
  });
});

describe("base64DecodedBytes", () => {
  it("accounts for padding", () => {
    expect(base64DecodedBytes("UklGRg==")).toBe(4); // "RIFF"
    expect(base64DecodedBytes("UklGRg")).toBe(4);
  });
});
