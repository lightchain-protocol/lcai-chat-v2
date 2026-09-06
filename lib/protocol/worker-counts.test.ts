import { describe, expect, it } from "vitest";
import { reconcileWorkerCount } from "./worker-counts";

describe("reconcileWorkerCount", () => {
  it("trusts a lower positive reading over the previous high", () => {
    expect(reconcileWorkerCount([1, 1, 1], 3)).toBe(1);
  });

  it("takes the best of a batch where one read flaked to zero", () => {
    expect(reconcileWorkerCount([0, 2, 2], undefined)).toBe(2);
  });

  it("keeps the last positive count when every read in the batch came back empty", () => {
    expect(reconcileWorkerCount([0, 0, 0], 3)).toBe(3);
  });

  it("reports zero for a model never seen with workers", () => {
    expect(reconcileWorkerCount([0, 0], undefined)).toBe(0);
  });

  it("falls back to the last known count when every read errored", () => {
    expect(reconcileWorkerCount([], 2)).toBe(2);
    expect(reconcileWorkerCount([], undefined)).toBeUndefined();
  });
});
