import { describe, expect, it } from "vitest";
import { isCompletedJobState, isSettledJobState } from "./job-state";

describe("isCompletedJobState", () => {
  it("accepts Completed and its terminal successors (Resolved, Released)", () => {
    expect(isCompletedJobState(2)).toBe(true);
    expect(isCompletedJobState(5)).toBe(true);
    expect(isCompletedJobState(6)).toBe(true);
  });

  it("rejects pre-completion and non-completion terminal states", () => {
    expect(isCompletedJobState(0)).toBe(false); // Submitted
    expect(isCompletedJobState(1)).toBe(false); // Acknowledged
    expect(isCompletedJobState(3)).toBe(false); // TimedOut
    expect(isCompletedJobState(4)).toBe(false); // Disputed
  });
});

describe("isSettledJobState", () => {
  it("accepts only the states in which the fee reached its final owner", () => {
    expect(isSettledJobState(5)).toBe(true); // Resolved
    expect(isSettledJobState(6)).toBe(true); // Released
  });

  it("rejects Completed: the job is still inside its dispute window", () => {
    expect(isSettledJobState(2)).toBe(false);
    for (const state of [0, 1, 3, 4]) {
      expect(isSettledJobState(state)).toBe(false);
    }
  });
});
