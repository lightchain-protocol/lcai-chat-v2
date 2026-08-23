import { describe, expect, it } from "vitest";
import {
  checkDuelFunding,
  DUEL_BOTH_FAILED_COPY,
  duelFailureCopy,
  duelHeading,
  getDuelMeta,
} from "./duel";

const LCAI = 10n ** 18n;

describe("checkDuelFunding", () => {
  it("passes when balance and allowance both cover both fees", () => {
    const verdict = checkDuelFunding({
      isAuthorized: true,
      balanceWei: 10n * LCAI,
      allowanceWei: 10n * LCAI,
      feeWeiA: LCAI / 100n,
      feeWeiB: LCAI / 20n,
    });
    expect(verdict.ok).toBe(true);
    if (verdict.ok) {
      expect(verdict.totalWei).toBe(LCAI / 100n + LCAI / 20n);
    }
  });

  it("fails closed when the delegate is not authorized", () => {
    const verdict = checkDuelFunding({
      isAuthorized: false,
      balanceWei: 10n * LCAI,
      allowanceWei: 10n * LCAI,
      feeWeiA: LCAI,
      feeWeiB: LCAI,
    });
    expect(verdict).toMatchObject({ ok: false, reason: "not-authorized" });
  });

  it("fails when the balance covers one job but not both", () => {
    const verdict = checkDuelFunding({
      isAuthorized: true,
      balanceWei: LCAI + LCAI / 2n,
      allowanceWei: 10n * LCAI,
      feeWeiA: LCAI,
      feeWeiB: LCAI,
    });
    expect(verdict).toMatchObject({
      ok: false,
      reason: "insufficient-balance",
      availableWei: LCAI + LCAI / 2n,
    });
  });

  // The allowance-leak case: refunds credit the balance but not the
  // allowance, so a full balance can still fail the allowance check.
  it("fails on allowance even with a full balance (post-refund leak)", () => {
    const verdict = checkDuelFunding({
      isAuthorized: true,
      balanceWei: 10n * LCAI,
      allowanceWei: LCAI,
      feeWeiA: LCAI,
      feeWeiB: LCAI,
    });
    expect(verdict).toMatchObject({
      ok: false,
      reason: "insufficient-allowance",
    });
  });

  it("handles zero-fee edges", () => {
    expect(
      checkDuelFunding({
        isAuthorized: true,
        balanceWei: 0n,
        allowanceWei: 0n,
        feeWeiA: 0n,
        feeWeiB: 0n,
      }).ok
    ).toBe(true);
  });
});

describe("duelHeading", () => {
  it("labels same-model duels as repeated runs, never a comparison", () => {
    expect(duelHeading("llama3-8b", "llama3-8b")).toBe("Two runs of llama3-8b");
  });

  it("labels cross-model duels as a comparison", () => {
    expect(duelHeading("llama3-8b", "qwen3-8b")).toBe("llama3-8b vs qwen3-8b");
  });
});

describe("duelFailureCopy", () => {
  it("names the prepaid balance, never the wallet, for refunds", () => {
    for (const failure of [
      "submit-reverted",
      "timeout",
      "stream-error",
    ] as const) {
      const copy = duelFailureCopy(failure);
      expect(copy).not.toContain("wallet");
      if (failure !== "submit-reverted") {
        expect(copy).toContain("prepaid balance");
      }
    }
  });

  it("says no fee was escrowed on a submit revert", () => {
    expect(duelFailureCopy("submit-reverted")).toContain("no fee was escrowed");
  });

  it("keeps the both-failed summary single and per-job honest", () => {
    expect(DUEL_BOTH_FAILED_COPY).toContain("independent");
    expect(DUEL_BOTH_FAILED_COPY).toContain("prepaid balance");
  });
});

describe("getDuelMeta", () => {
  it("parses a well-formed duel metadata record", () => {
    const meta = getDuelMeta({
      metadata: {
        createdAt: "2026-08-22T00:00:00.000Z",
        protocolMeta: {
          jobId: 12,
          duel: { group: "user-1", side: "B", model: "qwen3-8b" },
        },
      },
    });
    expect(meta).toEqual({ group: "user-1", side: "B", model: "qwen3-8b" });
  });

  it("returns null for ordinary messages", () => {
    expect(getDuelMeta({ metadata: undefined })).toBeNull();
    expect(getDuelMeta({ metadata: { createdAt: "x" } })).toBeNull();
    expect(
      getDuelMeta({ metadata: { protocolMeta: { jobId: 3 } } })
    ).toBeNull();
  });

  it("rejects malformed duel records instead of guessing", () => {
    expect(
      getDuelMeta({ metadata: { protocolMeta: { duel: "qwen3-8b" } } })
    ).toBeNull();
    expect(
      getDuelMeta({
        metadata: {
          protocolMeta: { duel: { group: "g", side: "C", model: "m" } },
        },
      })
    ).toBeNull();
    expect(
      getDuelMeta({
        metadata: { protocolMeta: { duel: { side: "A", model: "m" } } },
      })
    ).toBeNull();
  });
});
