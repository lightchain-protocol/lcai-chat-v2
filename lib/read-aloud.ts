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
}: {
  /** No worker currently serves the speech model. */
  unstaffed: boolean;
  /** A wallet is connected and can pay for the job. */
  walletReady: boolean;
  /** The hook's playback state: idle, synthesizing or playing. */
  state: string;
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
    return "Generating audio on a worker…";
  }
  return "Read aloud — sends this text to the tts-piper speech model as a paid on-chain job. A worker synthesizes it and the audio plays here; nothing is added to the chat.";
}
