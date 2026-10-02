/**
 * Client-side timing for a streaming answer.
 *
 * The worker reports its own generation stats on the terminal frame, but only
 * after the answer is done — during the stream there is no signal of progress
 * speed at all. These metrics are measured in the browser from real frame
 * arrivals (send time, first payload, first text, running character count),
 * so they are honest by construction: the live tok/s is an estimate derived
 * from rendered characters, and the UI reconciles to the worker's own
 * measured figure once the stats frame arrives.
 */

/** Characters per token heuristic. Used ONLY for the live estimate; the final
 * number comes from the worker's terminal stats frame. */
export const CHARS_PER_TOKEN_ESTIMATE = 4;

/**
 * Below this much elapsed text time a rate reading is meaningless (one chunk
 * arriving 5 ms after the first would read as thousands of tok/s), so the
 * snapshot reports null instead of a spike.
 */
export const MIN_RATE_WINDOW_MS = 400;

export type StreamMetricsSnapshot = {
  /** ms from user send to the first payload frame of any kind. */
  firstPayloadMs: number | null;
  /** ms from user send to the first answer-text frame (the TTFT). */
  ttftMs: number | null;
  /** Answer characters rendered so far (text kind only). */
  textChars: number;
  /** ms since the user hit send — the "~x / N tokens" progress readout. */
  elapsedMs: number;
  /** Characters/sec of answer text since the first text frame. */
  charsPerSecond: number | null;
  /** charsPerSecond / CHARS_PER_TOKEN_ESTIMATE. Labelled "~" in the UI. */
  tokensPerSecondEstimate: number | null;
};

/**
 * Accumulates timing for one response stream. All times come from the
 * injected clock so the math is unit-testable; production passes Date.now.
 */
export class StreamMetricsTracker {
  private firstPayloadAt: number | null = null;
  private firstTextAt: number | null = null;
  private textChars = 0;
  private readonly sentAt: number;
  private readonly now: () => number;

  /**
   * @param sentAt When the user hit send (ms epoch). The TTFT anchor.
   * @param now Clock injection point for tests; production uses Date.now.
   */
  constructor(sentAt: number, now: () => number = () => Date.now()) {
    this.sentAt = sentAt;
    this.now = now;
  }

  /** First payload frame of any kind (reasoning, text, metadata…). */
  markPayload(): void {
    if (this.firstPayloadAt === null) {
      this.firstPayloadAt = this.now();
    }
  }

  /** Answer-text characters appended; the first call also marks TTFT. */
  addTextChars(count: number): void {
    if (count <= 0) return;
    if (this.firstTextAt === null) {
      this.firstTextAt = this.now();
    }
    this.textChars += count;
  }

  snapshot(): StreamMetricsSnapshot {
    const firstPayloadMs =
      this.firstPayloadAt === null ? null : this.firstPayloadAt - this.sentAt;
    const ttftMs =
      this.firstTextAt === null ? null : this.firstTextAt - this.sentAt;

    let charsPerSecond: number | null = null;
    if (this.firstTextAt !== null) {
      const elapsedMs = this.now() - this.firstTextAt;
      if (elapsedMs >= MIN_RATE_WINDOW_MS && this.textChars > 0) {
        charsPerSecond = this.textChars / (elapsedMs / 1000);
      }
    }

    return {
      firstPayloadMs,
      ttftMs,
      textChars: this.textChars,
      elapsedMs: this.now() - this.sentAt,
      charsPerSecond,
      tokensPerSecondEstimate:
        charsPerSecond === null
          ? null
          : charsPerSecond / CHARS_PER_TOKEN_ESTIMATE,
    };
  }
}

/** "0.9 s", "12.4 s" — for the chip's TTFT readout. */
export function formatLatencyMs(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}
