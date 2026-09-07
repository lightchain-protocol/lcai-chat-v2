import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  formatThroughput,
  recordThroughput,
  typicalThroughput,
} from "./model-throughput";

const MODEL = "0xf4a414fa";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
  };
}

beforeEach(() => {
  vi.stubGlobal("window", { localStorage: memoryStorage() });
});

describe("model throughput", () => {
  it("says nothing until there is more than one observation", () => {
    // One answer is not a speed. Showing it would let a single cold load
    // define how a model looks forever.
    expect(typicalThroughput(MODEL)).toBeNull();
    recordThroughput(MODEL, 90);
    expect(typicalThroughput(MODEL)).toBeNull();
    recordThroughput(MODEL, 92);
    expect(typicalThroughput(MODEL)).toBe(91);
  });

  it("uses the median so one cold load does not define the model", () => {
    // A cold model load can take seconds; a mean would drag the figure far
    // below what the next message actually does.
    for (const v of [95, 92, 4, 96, 94]) recordThroughput(MODEL, v);
    expect(typicalThroughput(MODEL)).toBe(94);
  });

  it("keeps only recent samples so a fleet upgrade shows through", () => {
    for (let i = 0; i < 20; i++) recordThroughput(MODEL, 4);
    for (let i = 0; i < 7; i++) recordThroughput(MODEL, 95);
    expect(typicalThroughput(MODEL)).toBe(95);
  });

  it("treats a model id case-insensitively", () => {
    recordThroughput(MODEL.toUpperCase(), 50);
    recordThroughput(MODEL, 50);
    expect(typicalThroughput(MODEL)).toBe(50);
  });

  it("ignores malformed measurements rather than throwing", () => {
    // This runs inside the response path; a bad stats frame must cost a hint,
    // never the answer.
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => recordThroughput(MODEL, bad)).not.toThrow();
    }
    expect(typicalThroughput(MODEL)).toBeNull();
  });

  it("survives storage being unavailable", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => {
          throw new Error("denied");
        },
        setItem: () => {
          throw new Error("denied");
        },
      },
    });
    expect(() => recordThroughput(MODEL, 90)).not.toThrow();
    expect(typicalThroughput(MODEL)).toBeNull();
  });
});

describe("formatThroughput", () => {
  it("keeps a decimal where it changes the decision", () => {
    // Below 10 tok/s the difference between 3.9 and 4.4 is the difference
    // between slow and unusable.
    expect(formatThroughput(3.94)).toBe("~3.9 tok/s");
  });

  it("drops decimals once they are noise", () => {
    expect(formatThroughput(95.65)).toBe("~96 tok/s");
  });
});
