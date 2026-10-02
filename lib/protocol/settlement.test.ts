import { describe, expect, it } from "vitest";
import { reduceSettlement, type SettlementProgress } from "./settlement";

const CHAIN_OBS = {
  type: "chainObserved" as const,
  atMs: 2000,
  worker: "0xA2C40000000000000000000000000000000091f0",
  escrowedFeeWei: "2000000000000000",
  deadlineSec: 1_700_000_120,
  acknowledged: true,
};

describe("reduceSettlement", () => {
  it("starts the journey at escrowed", () => {
    const s = reduceSettlement(null, { type: "escrowed", atMs: 1000 });
    expect(s.stage).toBe("escrowed");
    expect(s.escrowedAtMs).toBe(1000);
  });

  it("records chain evidence: worker, escrow, deadline, on-chain ack", () => {
    const s = reduceSettlement(
      reduceSettlement(null, { type: "escrowed", atMs: 1000 }),
      CHAIN_OBS
    );
    expect(s.stage).toBe("acknowledged");
    expect(s.worker).toBe(CHAIN_OBS.worker);
    expect(s.escrowedFeeWei).toBe(CHAIN_OBS.escrowedFeeWei);
    expect(s.deadlineSec).toBe(CHAIN_OBS.deadlineSec);
    expect(s.acknowledgedOnChain).toBe(true);
    expect(s.acknowledgedAtMs).toBe(2000);
  });

  it("frames flowing imply acknowledgement but never upgrade it to on-chain", () => {
    const s = reduceSettlement(
      reduceSettlement(null, { type: "escrowed", atMs: 1000 }),
      { type: "firstFrame", atMs: 3000 }
    );
    expect(s.stage).toBe("streaming");
    expect(s.acknowledgedAtMs).toBe(3000);
    expect(s.acknowledgedOnChain).toBeUndefined();
  });

  it("tolerates the normal out-of-order case: frames first, chain read later", () => {
    let s: SettlementProgress = reduceSettlement(null, {
      type: "escrowed",
      atMs: 1000,
    });
    s = reduceSettlement(s, { type: "firstFrame", atMs: 3000 });
    s = reduceSettlement(s, { type: "firstText", atMs: 3400 });
    // The getJob read resolves after streaming has already started.
    s = reduceSettlement(s, { ...CHAIN_OBS, atMs: 3500 });

    // Stage must not regress, the earliest ack evidence (the frame) keeps its
    // timestamp, and the weak evidence is upgraded to on-chain by the read.
    expect(s.stage).toBe("streaming");
    expect(s.acknowledgedAtMs).toBe(3000);
    expect(s.acknowledgedOnChain).toBe(true);
    expect(s.firstTextAtMs).toBe(3400);
  });

  it("settles and then records the on-chain completion time", () => {
    let s = reduceSettlement(null, { type: "escrowed", atMs: 1000 });
    s = reduceSettlement(s, { type: "settled", atMs: 9000 });
    expect(s.stage).toBe("settled");
    s = reduceSettlement(s, {
      type: "chainSettled",
      completedAtSec: 1_700_000_009,
    });
    expect(s.settledOnChainSec).toBe(1_700_000_009);
    expect(s.settledAtMs).toBe(9000);
  });

  it("failed is sticky: later events cannot resurrect the journey", () => {
    let s = reduceSettlement(null, { type: "escrowed", atMs: 1000 });
    s = reduceSettlement(s, {
      type: "failed",
      atMs: 5000,
      reason: "No answer came back from the worker in time.",
    });
    expect(s.stage).toBe("failed");
    expect(s.failedReason).toContain("worker");

    s = reduceSettlement(s, { type: "settled", atMs: 6000 });
    expect(s.stage).toBe("failed");
    expect(s.settledAtMs).toBeUndefined();
  });

  it("a failed journey keeps earlier milestones for the timeline", () => {
    let s = reduceSettlement(null, { type: "escrowed", atMs: 1000 });
    s = reduceSettlement(s, CHAIN_OBS);
    s = reduceSettlement(s, { type: "failed", atMs: 5000, reason: "boom" });
    expect(s.stage).toBe("failed");
    expect(s.worker).toBe(CHAIN_OBS.worker);
    expect(s.acknowledgedAtMs).toBe(2000);
  });
});
