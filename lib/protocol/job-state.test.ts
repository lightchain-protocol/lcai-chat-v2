import { describe, expect, it } from "vitest";
import { isCompletedJobState } from "./job-state";

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
