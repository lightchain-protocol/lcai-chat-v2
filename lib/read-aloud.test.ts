import { describe, expect, it } from "vitest";
import { readAloudProgressLabel, readAloudTooltip } from "./read-aloud";

const idle = { unstaffed: false, walletReady: true, state: "idle" };

describe("readAloudTooltip", () => {
  it("explains the mechanism when the button is usable", () => {
    const tip = readAloudTooltip(idle);

    // Someone is about to be charged: they should know it costs a fee, that a
    // worker does the work, and which model produces the voice.
    expect(tip).toMatch(/paid/i);
    expect(tip).toMatch(/worker/i);
    expect(tip).toContain("tts-piper");
  });

  it("says nothing is added to the chat, because that is not obvious", () => {
    expect(readAloudTooltip(idle)).toMatch(/nothing is added to the chat/i);
  });

  it("leads with the reason it cannot be used when nobody serves speech", () => {
    const tip = readAloudTooltip({ ...idle, unstaffed: true });

    expect(tip).toMatch(/no speech worker/i);
    // Tells them it is temporary rather than leaving them to guess.
    expect(tip).toMatch(/come back/i);
  });

  it("prefers the unstaffed reason over the wallet one", () => {
    // Both are true for a signed-out visitor during an outage. Being told to
    // connect a wallet would send them down a path that still fails.
    const tip = readAloudTooltip({
      unstaffed: true,
      walletReady: false,
      state: "idle",
    });

    expect(tip).toMatch(/no speech worker/i);
    expect(tip).not.toMatch(/connect a wallet/i);
  });

  it("asks for a wallet when that is the only thing missing", () => {
    expect(readAloudTooltip({ ...idle, walletReady: false })).toMatch(
      /connect a wallet/i
    );
  });

  it("offers Stop while playing", () => {
    expect(readAloudTooltip({ ...idle, state: "playing" })).toBe("Stop");
  });

  it("reports the current phase while synthesizing", () => {
    // Before the first phase arrives there is nothing specific to report,
    // so it still says work is under way rather than showing the idle
    // explainer as though the click had not registered.
    expect(readAloudTooltip({ ...idle, state: "synthesizing" })).toBe(
      readAloudProgressLabel(undefined)
    );
    expect(
      readAloudTooltip({ ...idle, state: "synthesizing", progress: "thinking" })
    ).toMatch(/generating/i);
  });

  it("never apologises", () => {
    for (const state of ["idle", "playing", "synthesizing"]) {
      for (const unstaffed of [true, false]) {
        for (const walletReady of [true, false]) {
          expect(readAloudTooltip({ unstaffed, walletReady, state })).not.toMatch(
            /sorry|oops|unfortunately/i
          );
        }
      }
    }
  });
});

describe("readAloudProgressLabel", () => {
  it("names who the wait is on, not what the code is doing", () => {
    expect(readAloudProgressLabel("finding_worker")).toMatch(/worker/i);
    expect(readAloudProgressLabel("waiting_for_relay")).toMatch(/worker/i);
    expect(readAloudProgressLabel("submitting_job")).toMatch(/on chain/i);
  });

  it("never leaks a raw status token for a phase it does not know", () => {
    // A new protocol status must not surface as "waiting_for_relay" on a
    // user's screen.
    const label = readAloudProgressLabel(
      "some_future_status" as Parameters<typeof readAloudProgressLabel>[0]
    );
    expect(label).not.toMatch(/_/);
    expect(label).toMatch(/preparing audio/i);
  });

  it("handles an absent status", () => {
    expect(readAloudProgressLabel(undefined)).toMatch(/preparing audio/i);
  });

  it("is always short enough to sit beside a button", () => {
    const statuses = [
      "idle", "finding_worker", "preparing_chat", "writing_on_chain",
      "submitting_job", "waiting_for_relay", "decoding_prompt", "thinking",
      "reasoning", "streaming", "completed", "error",
    ] as const;
    for (const status of statuses) {
      expect(readAloudProgressLabel(status).length).toBeLessThanOrEqual(34);
    }
  });
});

describe("readAloudTooltip while a job is in flight", () => {
  it("repeats the same phase the badge shows, not a vaguer one", () => {
    const tip = readAloudTooltip({
      unstaffed: false,
      walletReady: true,
      state: "synthesizing",
      progress: "waiting_for_relay",
    });
    expect(tip).toBe(readAloudProgressLabel("waiting_for_relay"));
  });
});
