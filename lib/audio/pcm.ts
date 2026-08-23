/**
 * Pure PCM/WAV primitives shared by voice-in (recording) and voice-out
 * (playback). Everything here is byte math and unit-tested; the
 * MediaRecorder/WebAudio wiring lives in voice-recorder.ts and
 * pcm-player.ts, which stay thin over these functions.
 *
 * Wire formats, fixed by the worker sidecars
 * (provisioning/worker/voice-sidecars.md):
 *  - Voice IN: WAV container, s16le mono. Whisper resamples any rate to
 *    16 kHz internally, so we send 8 kHz — the envelope audio field is
 *    base64-capped by the worker at 131,072 chars (~96 KB decoded), and
 *    8 kHz doubles the recordable seconds versus 16 kHz.
 *  - Voice OUT: raw PCM s16le 24 kHz mono, no header, in 32 KiB chunks.
 */

export const VOICE_PROMPT_SAMPLE_RATE = 8000;

/** Decoded byte ceiling implied by the worker's maxPromptAudioB64. */
export const MAX_PROMPT_AUDIO_BYTES = Math.floor((131_072 * 3) / 4); // 98,304

const WAV_HEADER_BYTES = 44;

/** Hard recording cap: header + samples must fit MAX_PROMPT_AUDIO_BYTES. */
export const MAX_VOICE_CLIP_SECONDS = Math.floor(
  (MAX_PROMPT_AUDIO_BYTES - WAV_HEADER_BYTES) / (VOICE_PROMPT_SAMPLE_RATE * 2)
); // 6 s at 8 kHz

/** s16le little-endian bytes → float samples in [-1, 1]. */
export function s16leBytesToFloat32(bytes: Uint8Array): Float32Array {
  const sampleCount = Math.floor(bytes.length / 2);
  const out = new Float32Array(sampleCount);
  const view = new DataView(bytes.buffer, bytes.byteOffset, sampleCount * 2);
  for (let i = 0; i < sampleCount; i++) {
    out[i] = view.getInt16(i * 2, true) / 32_768;
  }
  return out;
}

/** Float samples in [-1, 1] → s16le little-endian bytes (clamped). */
export function float32ToS16leBytes(samples: Float32Array): Uint8Array {
  const out = new Uint8Array(samples.length * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    // Round toward the fuller-scale convention so -1 maps to -32768.
    const int = Math.round(clamped * 32_767);
    view.setInt16(i * 2, clamped <= -1 ? -32_768 : int, true);
  }
  return out;
}

/** Wraps mono s16le float samples in a canonical 44-byte WAV header. */
export function encodeWavMonoS16le(
  samples: Float32Array,
  sampleRate: number
): Uint8Array {
  const pcm = float32ToS16leBytes(samples);
  const wav = new Uint8Array(WAV_HEADER_BYTES + pcm.length);
  const view = new DataView(wav.buffer);

  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) {
      wav[offset + i] = text.charCodeAt(i);
    }
  };

  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + pcm.length, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true); // PCM fmt chunk size
  view.setUint16(20, 1, true); // PCM format tag
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeAscii(36, "data");
  view.setUint32(40, pcm.length, true);
  wav.set(pcm, WAV_HEADER_BYTES);
  return wav;
}

/** Decoded byte length of a base64 string, padding-aware. */
export function base64DecodedBytes(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}
