/**
 * Voice-prompt recorder: MediaRecorder capture → decode → resample to 8 kHz
 * mono → WAV s16le → bare base64 for the prompt envelope.
 *
 * Browser-only, like downscaleImageToBase64: the byte-level work is the
 * unit-tested lib/audio/pcm.ts; this file is the thin capture wiring.
 *
 * Why 8 kHz: the envelope audio field is base64-capped by the worker at
 * 131,072 chars (~96 KB decoded) and the whisper sidecar resamples any WAV
 * rate to 16 kHz internally, so a lower send rate buys recordable seconds
 * (6 s vs 3 s) at some transcription-quality cost. That tradeoff is pinned
 * in pcm.ts (MAX_VOICE_CLIP_SECONDS).
 */

import {
  encodeWavMonoS16le,
  MAX_VOICE_CLIP_SECONDS,
  VOICE_PROMPT_SAMPLE_RATE,
} from "./pcm";

export type VoiceClip = {
  /** Bare base64 WAV (no data: prefix), ready for the envelope audio field. */
  wavBase64: string;
  seconds: number;
};

export type VoiceRecorder = {
  /** Stops capture and resolves the encoded clip. Idempotent. */
  stop: () => Promise<VoiceClip>;
  /** Abandons the recording without producing a clip. */
  cancel: () => void;
};

function bytesToBase64Chunked(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(binary);
}

/**
 * Starts recording. Rejects if the mic is unavailable or the environment is
 * not a browser. The clip auto-stops at MAX_VOICE_CLIP_SECONDS — the envelope
 * budget leaves no room for more, and failing at record time beats failing
 * after the consumer has paid.
 */
export async function startVoiceRecording(options?: {
  onAutoStop?: (clip: Promise<VoiceClip>) => void;
}): Promise<VoiceRecorder> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices) {
    throw new Error("Voice recording needs a browser with microphone access");
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1 },
  });

  const recorder = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };
  recorder.start();

  let settled = false;
  let autoStopTimer: ReturnType<typeof setTimeout> | undefined;

  const release = () => {
    if (autoStopTimer !== undefined) clearTimeout(autoStopTimer);
    for (const track of stream.getTracks()) track.stop();
  };

  const encode = async (): Promise<VoiceClip> => {
    const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
    // Decode whatever container the browser produced, then resample through
    // an OfflineAudioContext — the only resampler with correct filters that
    // every supported browser ships.
    const decodeCtx = new AudioContext();
    try {
      const decoded = await decodeCtx.decodeAudioData(await blob.arrayBuffer());
      const seconds = Math.min(decoded.duration, MAX_VOICE_CLIP_SECONDS);
      const frameCount = Math.max(
        1,
        Math.round(seconds * VOICE_PROMPT_SAMPLE_RATE)
      );
      const offline = new OfflineAudioContext(
        1,
        frameCount,
        VOICE_PROMPT_SAMPLE_RATE
      );
      const source = offline.createBufferSource();
      source.buffer = decoded;
      source.connect(offline.destination);
      source.start(0);
      const rendered = await offline.startRendering();
      const samples = rendered.getChannelData(0);
      const wav = encodeWavMonoS16le(samples, VOICE_PROMPT_SAMPLE_RATE);
      return { wavBase64: bytesToBase64Chunked(wav), seconds };
    } finally {
      decodeCtx.close().catch(() => {
        /* best-effort */
      });
    }
  };

  const stop = (): Promise<VoiceClip> => {
    if (settled) {
      return Promise.reject(new Error("recording already stopped"));
    }
    settled = true;
    release();
    return new Promise<VoiceClip>((resolve, reject) => {
      recorder.onstop = () => {
        encode().then(resolve, reject);
      };
      if (recorder.state !== "inactive") recorder.stop();
      else encode().then(resolve, reject);
    });
  };

  autoStopTimer = setTimeout(() => {
    options?.onAutoStop?.(stop());
  }, MAX_VOICE_CLIP_SECONDS * 1000);

  return {
    stop,
    cancel: () => {
      if (settled) return;
      settled = true;
      release();
      if (recorder.state !== "inactive") recorder.stop();
    },
  };
}
