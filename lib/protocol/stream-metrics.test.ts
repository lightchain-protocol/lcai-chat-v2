import { describe, expect, it } from "vitest";
import {
  CHARS_PER_TOKEN_ESTIMATE,
  formatLatencyMs,
  MIN_RATE_WINDOW_MS,
  StreamMetricsTracker,
} from "./stream-metrics";

/** Deterministic clock: an array of instants the tracker walks through. */
function fakeClock(start = 1_000_000) {
  let t = start;
  return {
    now: () => t,
    advance(ms: number) {
      t += ms;
    },
  };
}

describe("StreamMetricsTracker", () => {
  it("reports nulls before any frame arrives", () => {
    const clock = fakeClock();
    const tracker = new StreamMetricsTracker(clock.now(), clock.now);
    const snap = tracker.snapshot();
    expect(snap.firstPayloadMs).toBeNull();
    expect(snap.ttftMs).toBeNull();
    expect(snap.textChars).toBe(0);
    expect(snap.charsPerSecond).toBeNull();
    expect(snap.tokensPerSecondEstimate).toBeNull();
  });

  it("measures TTFT from send to the first TEXT frame, not the first payload", () => {
    const clock = fakeClock();
    const tracker = new StreamMetricsTracker(clock.now(), clock.now);

    // Reasoning arrives first (1.2 s), answer text later (3.4 s).
    clock.advance(1200);
    tracker.markPayload();
    clock.advance(2200);
    tracker.addTextChars(10);

    const snap = tracker.snapshot();
    expect(snap.firstPayloadMs).toBe(1200);
    expect(snap.ttftMs).toBe(3400);
  });

  it("suppresses the rate below the minimum window instead of spiking", () => {
    const clock = fakeClock();
    const tracker = new StreamMetricsTracker(clock.now(), clock.now);
    tracker.addTextChars(50);
    clock.advance(MIN_RATE_WINDOW_MS - 1);
    expect(tracker.snapshot().charsPerSecond).toBeNull();

    clock.advance(1);
    expect(tracker.snapshot().charsPerSecond).not.toBeNull();
  });

  it("computes chars/sec over text time and the ~4-chars-per-token estimate", () => {
    const clock = fakeClock();
    const tracker = new StreamMetricsTracker(clock.now(), clock.now);
    tracker.addTextChars(100);
    clock.advance(2000);
    tracker.addTextChars(300);

    const snap = tracker.snapshot();
    expect(snap.textChars).toBe(400);
    expect(snap.charsPerSecond).toBeCloseTo(200, 5);
    expect(snap.tokensPerSecondEstimate).toBeCloseTo(
      200 / CHARS_PER_TOKEN_ESTIMATE,
      5
    );
  });

  it("ignores zero-length deltas and never resets the first marks", () => {
    const clock = fakeClock();
    const tracker = new StreamMetricsTracker(clock.now(), clock.now);
    tracker.markPayload();
    clock.advance(100);
    tracker.markPayload();
    tracker.addTextChars(0);
    expect(tracker.snapshot().firstPayloadMs).toBe(0);
    expect(tracker.snapshot().ttftMs).toBeNull();
  });
});

describe("formatLatencyMs", () => {
  it("renders one-decimal seconds", () => {
    expect(formatLatencyMs(900)).toBe("0.9 s");
    expect(formatLatencyMs(12_345)).toBe("12.3 s");
  });
});
