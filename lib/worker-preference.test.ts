import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  isAvoided,
  isPinned,
  MAX_AVOIDED_WORKERS,
  preferenceRequestFields,
  readWorkerPreference,
  toggleAvoided,
  togglePinned,
} from "./worker-preference";

const A = "0x00000000000000000000000000000000000000aa";
const B = "0x00000000000000000000000000000000000000bb";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  };
}

beforeEach(() => {
  vi.stubGlobal("window", { localStorage: memoryStorage() });
});

describe("worker preference", () => {
  it("starts empty and sends nothing, so an untouched client is unchanged", () => {
    expect(readWorkerPreference().avoid).toEqual([]);
    expect(preferenceRequestFields()).toBeUndefined();
  });

  it("avoids and un-avoids a worker", () => {
    toggleAvoided(A);
    expect(isAvoided(A, readWorkerPreference())).toBe(true);
    toggleAvoided(A);
    expect(isAvoided(A, readWorkerPreference())).toBe(false);
  });

  it("treats a checksummed address as the same worker", () => {
    // The chain returns checksummed addresses and storage holds lowercase; a
    // mismatch here would silently stop honouring the preference.
    toggleAvoided(A);
    const checksummed = A.toUpperCase().replace("0X", "0x");
    expect(isAvoided(checksummed, readWorkerPreference())).toBe(true);
  });

  it("pins a worker and unpins on a second toggle", () => {
    togglePinned(A);
    expect(isPinned(A, readWorkerPreference())).toBe(true);
    togglePinned(A);
    expect(isPinned(A, readWorkerPreference())).toBe(false);
  });

  it("moves the pin rather than accumulating pins", () => {
    togglePinned(A);
    togglePinned(B);
    const pref = readWorkerPreference();
    expect(isPinned(B, pref)).toBe(true);
    expect(isPinned(A, pref)).toBe(false);
  });

  it("clears the pin when the pinned worker is then avoided", () => {
    // Holding both would send the API a contradiction; the wish expressed
    // second should win.
    togglePinned(A);
    toggleAvoided(A);
    const pref = readWorkerPreference();
    expect(isAvoided(A, pref)).toBe(true);
    expect(pref.prefer).toBeUndefined();
  });

  it("lifts an exclusion when the avoided worker is then pinned", () => {
    toggleAvoided(A);
    togglePinned(A);
    const pref = readWorkerPreference();
    expect(isPinned(A, pref)).toBe(true);
    expect(isAvoided(A, pref)).toBe(false);
  });

  it("caps the avoid list at the API's limit", () => {
    for (let i = 0; i < MAX_AVOIDED_WORKERS + 5; i++) {
      toggleAvoided(`0x${String(i).padStart(40, "0")}`);
    }
    expect(readWorkerPreference().avoid.length).toBeLessThanOrEqual(
      MAX_AVOIDED_WORKERS
    );
  });

  it("sends only the fields that were actually set", () => {
    toggleAvoided(A);
    expect(preferenceRequestFields()).toEqual({ avoidWorkers: [A] });
    togglePinned(B);
    expect(preferenceRequestFields()).toEqual({
      avoidWorkers: [A],
      preferWorker: B,
    });
  });

  it("survives storage being unavailable", () => {
    // Private windows and some embedded browsers throw on access. Losing a
    // preference must never stop someone sending a message.
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
    expect(readWorkerPreference().avoid).toEqual([]);
    expect(() => toggleAvoided(A)).not.toThrow();
  });

  it("ignores corrupt stored data instead of throwing", () => {
    const storage = memoryStorage();
    storage.setItem("lcai.worker-preference.v1", "{not json");
    vi.stubGlobal("window", { localStorage: storage });
    expect(readWorkerPreference().avoid).toEqual([]);
  });
});
