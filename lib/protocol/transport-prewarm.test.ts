import { describe, expect, it, vi } from "vitest";

// lib/http pulls in the auth module, which only loads inside Next.
vi.mock("../http", () => ({ $http: {} }));

// The transport's module graph reaches browser-only code (session storage,
// wallet clients); only its session manager matters here, so stub the module.
vi.mock("./session", () => ({
  MaxReassignmentsError: class extends Error {},
  MissingDisputerKeyError: class extends Error {},
  SessionManager: class {
    status = "idle";
    private cb?: (s: string) => void;
    setOnStatusChange(cb: (s: string) => void) {
      this.cb = cb;
    }
    async initialize() {
      this.status = "preparing";
      this.cb?.("preparing");
      await Promise.resolve();
      this.status = "ready";
      this.cb?.("ready");
    }
  },
}));

const { ProtocolTransport } = await import("./transport");

function makeTransport() {
  return new ProtocolTransport({
    gateway: {},
    publicClient: { chain: { id: 1 } },
  } as never);
}

describe("ProtocolTransport.prewarm", () => {
  it("flags session activity that no send asked for", async () => {
    const t = makeTransport();
    const seen: boolean[] = [];
    t.setOnSessionStatus(() => seen.push(t.isWarmingOnly));

    expect(t.isWarmingOnly).toBe(false);
    await t.prewarm();

    // Every status the warm produced was reported as warm-only, and the flag
    // drops once the warm settles.
    expect(seen).toEqual([true, true]);
    expect(t.isWarmingOnly).toBe(false);
  });
});
