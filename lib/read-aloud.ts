import type { ProtocolLoadingStatus } from "./types";

/**
 * What read-aloud is doing right now, in words.
 *
 * Reading a message aloud takes ~30 seconds: a session has to be claimed by a
 * worker, the job submitted on chain, and the audio synthesized and returned.
 * A spinner alone for that long reads as a hang, so each phase says what is
 * happening and, where the wait is not ours, who it is waiting on.
 *
 * Unlisted phases fall back to the generic line rather than showing a raw
 * status token — a new status in the protocol must never leak
 * "waiting_for_relay" into someone's screen.
 */
export function readAloudProgressLabel(
  status: ProtocolLoadingStatus | undefined
): string {
  switch (status) {
    case "finding_worker":
      return "Finding a worker…";
    case "preparing_chat":
      return "Preparing a secure session…";
    case "writing_on_chain":
    case "submitting_job":
      return "Submitting the job on chain…";
    case "waiting_for_relay":
      return "Waiting for the worker…";
    case "thinking":
    case "streaming":
    case "decoding_prompt":
      return "Generating audio…";
    default:
      return "Preparing audio…";
  }
}

/**
 * What the read-aloud button says, in priority order: why it cannot be used
 * first, then what it does.
 *
 * The idle text explains the mechanism because read-aloud is not a local
 * browser voice — it spends a fee, runs on the same worker network as the
 * chat, and the audio comes back from the `tts-piper` speech model. Anyone
 * deciding whether to click deserves all three facts before being charged.
 */
export function readAloudTooltip({
  unstaffed,
  walletReady,
  state,
  progress,
}: {
  /** No worker currently serves the speech model. */
  unstaffed: boolean;
  /** A wallet is connected and can pay for the job. */
  walletReady: boolean;
  /** The hook's playback state: idle, synthesizing or playing. */
  state: string;
  /** Protocol phase, while a job is in flight. */
  progress?: ProtocolLoadingStatus;
}): string {
  // Blockers first, most specific first: an unstaffed network cannot be fixed
  // by connecting a wallet, so telling a signed-out visitor to connect one
  // during an outage would send them down a path that still fails.
  if (unstaffed) {
    return "No speech worker is online right now. Read aloud will come back when one does.";
  }
  if (!walletReady) {
    return "Connect a wallet to read messages aloud";
  }
  if (state === "playing") {
    return "Stop";
  }
  if (state === "synthesizing") {
    // Mirrors the badge so hovering mid-job repeats the same phase rather
    // than a vaguer version of it.
    return readAloudProgressLabel(progress);
  }
  return "Read aloud — sends this text to the tts-piper speech model as a paid on-chain job. A worker synthesizes it and the audio plays here; nothing is added to the chat.";
}
