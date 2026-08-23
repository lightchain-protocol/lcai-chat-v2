"use client";

import { AudioLines, Square } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  createPcmStreamPlayer,
  type PcmStreamPlayer,
} from "@/lib/audio/pcm-player";
import type { AudioStreamDescriptor } from "@/lib/protocol/audio-stream";
import { base64ToBytes } from "@/lib/protocol/base64";
import { cn } from "@/lib/utils";
import { DELIVERED_NOT_SETTLED_LABEL } from "./artifact";
import { Button } from "./ui/button";

/**
 * Live voice-output player for one assistant message.
 *
 * Consumes the `data-audioStream` descriptor (reconciled in place) and the
 * `data-audioChunk` PCM parts (appended live, never persisted). Chunks are
 * scheduled on one AudioContext as they arrive; a Stop button cuts playback.
 *
 * Honesty boundary (bc-2-nontext-settlement.md §5): audio is DELIVERED, NOT
 * SETTLED. The badge says so; the final descriptor's `contentHash` is shown
 * as "computed locally, not committed on-chain". After a reload only the
 * descriptor survives (PCM is live-only, like the response ciphertext), and
 * the card says that instead of pretending a replay is possible.
 */
export function AudioStreamPlayer({
  descriptor,
  chunks,
  live,
  className,
}: {
  descriptor: AudioStreamDescriptor;
  chunks: Array<{ seq: number; pcm: string }>;
  /** True while the assistant turn is still streaming. */
  live: boolean;
  className?: string;
}) {
  const playerRef = useRef<PcmStreamPlayer | null>(null);
  const consumedSeqRef = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [stopped, setStopped] = useState(false);

  const player = useMemo(() => {
    const p = createPcmStreamPlayer(() => setPlaying(false));
    playerRef.current = p;
    return p;
  }, []);

  // Unmount mid-answer must cut the speaker, not leak playback.
  useEffect(() => {
    return () => player.stop();
  }, [player]);

  useEffect(() => {
    const fresh = chunks
      .filter((c) => c.seq > consumedSeqRef.current)
      .sort((a, b) => a.seq - b.seq);
    for (const chunk of fresh) {
      consumedSeqRef.current = chunk.seq;
      try {
        player.push(base64ToBytes(chunk.pcm), descriptor.sampleRate || 24_000);
        setPlaying(true);
      } catch {
        // A corrupt chunk costs a moment of audio, never the message.
      }
    }
  }, [chunks, descriptor.sampleRate, player]);

  const handleStop = () => {
    player.stop();
    setStopped(true);
    setPlaying(false);
  };

  const hasAudio = chunks.length > 0;
  const finished = descriptor.final === true;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-xl border border-bdr-light px-3 py-2 text-xs",
        className
      )}
      data-testid="audio-stream-player"
    >
      <AudioLines
        className={cn(
          "size-4 text-content-secondary",
          playing && !stopped && "animate-pulse text-primary"
        )}
      />
      {stopped ? (
        <span className="text-content-secondary">Voice answer stopped</span>
      ) : playing || (live && hasAudio) ? (
        <span className="text-content-default">
          Speaking{descriptor.voice ? ` · ${descriptor.voice}` : ""}
        </span>
      ) : hasAudio ? (
        <span className="text-content-secondary">Voice answer played</span>
      ) : (
        // Post-reload: only the persisted descriptor survives.
        <span className="text-content-secondary">
          Voice answer delivered live · audio is not retained after reload
        </span>
      )}

      {(playing || (live && hasAudio)) && !stopped && (
        <Button
          className="h-6 gap-1 rounded-md px-2 text-[11px]"
          onClick={handleStop}
          type="button"
          variant="ghost"
        >
          <Square size={10} />
          Stop
        </Button>
      )}

      <span
        className="ml-auto rounded bg-muted px-1.5 py-0.5 text-[10px] text-content-secondary"
        title="Audio frames carry no on-chain commitment yet"
      >
        {DELIVERED_NOT_SETTLED_LABEL}
      </span>

      {finished && descriptor.contentHash && (
        <span
          className="w-full font-mono text-[10px] text-content-subtle"
          title="keccak256 of the delivered PCM — computed locally, not committed on-chain"
        >
          integrity {descriptor.contentHash.slice(0, 10)}…
          {descriptor.contentHash.slice(-6)} · computed locally, not committed
          on-chain
        </span>
      )}
      {descriptor.truncated && (
        <span className="w-full text-[10px] text-content-subtle">
          Audio was cut to the synthesis length limit.
        </span>
      )}
    </div>
  );
}
