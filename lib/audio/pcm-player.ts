/**
 * Streaming PCM player for voice output.
 *
 * The worker streams `audio` frames as 32 KiB chunks of raw PCM s16le
 * 24 kHz mono (no WAV header — the sidecar contract is
 * `audio/L16;rate=24000;channels=1`). Chunks are converted with the tested
 * pcm.ts primitives and scheduled back-to-back on one AudioContext timeline
 * for gapless playback.
 *
 * Honesty: playback is a live-session convenience. Nothing here implies any
 * on-chain provenance for the audio — see bc-2-nontext-settlement.md §5.
 */

import { s16leBytesToFloat32 } from "./pcm";

export type PcmStreamPlayer = {
  /** Queue one PCM chunk. Sample rate is per-chunk because the header descriptor is the source of truth. */
  push: (pcm: Uint8Array, sampleRate: number) => void;
  /** Stops playback and releases the AudioContext. Idempotent. */
  stop: () => void;
  /** True while scheduled audio remains to play. */
  isPlaying: () => boolean;
};

export function createPcmStreamPlayer(onEnded?: () => void): PcmStreamPlayer {
  let ctx: AudioContext | null = null;
  let nextStart = 0;
  let scheduled = 0;
  let played = 0;
  let stopped = false;
  let endedFired = false;

  const ensureContext = () => {
    if (!ctx) {
      ctx = new AudioContext();
      nextStart = ctx.currentTime + 0.05; // small lead-in jitter buffer
    }
    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {
        /* best-effort */
      });
    }
    return ctx;
  };

  const maybeEnd = () => {
    if (stopped || endedFired || !ctx) return;
    if (scheduled > 0 && played >= scheduled) {
      endedFired = true;
      onEnded?.();
    }
  };

  return {
    push(pcm, sampleRate) {
      if (stopped || pcm.length < 2) return;
      const context = ensureContext();
      const samples = s16leBytesToFloat32(pcm);
      const buffer = context.createBuffer(1, samples.length, sampleRate);
      buffer.getChannelData(0).set(samples);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      const startAt = Math.max(nextStart, context.currentTime);
      source.start(startAt);
      nextStart = startAt + buffer.duration;
      scheduled += 1;
      source.onended = () => {
        played += 1;
        maybeEnd();
      };
    },
    stop() {
      stopped = true;
      ctx?.close().catch(() => {
        /* best-effort */
      });
      ctx = null;
    },
    isPlaying() {
      return !stopped && scheduled > played;
    },
  };
}
