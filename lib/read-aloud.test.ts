import { describe, expect, it } from "vitest";
import { readAloudTooltip } from "./read-aloud";

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

  it("says work is happening while synthesizing", () => {
    expect(readAloudTooltip({ ...idle, state: "synthesizing" })).toMatch(
      /generating/i
    );
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
