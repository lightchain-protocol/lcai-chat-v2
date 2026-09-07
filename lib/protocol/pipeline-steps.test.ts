import { describe, expect, it } from "vitest";
import { buildSteps, type Evidence } from "./pipeline-steps";
import type { TrackedJob } from "./transport";

const WORKER = "0x00000000000000000000000000000000000000aa";

function job(overrides: Partial<TrackedJob> = {}): TrackedJob {
  return {
    jobId: 7,
    sessionId: 3,
    chatId: "chat-1",
    worker: WORKER,
    deadline: 0,
    completedAt: 0,
    escrowedFee: 0n,
    startedAt: 1000,
    status: "streaming",
    ...overrides,
  };
}

function stateOf(steps: ReturnType<typeof buildSteps>["steps"], key: string) {
  return steps.find((s) => s.key === key)?.state;
}

describe("buildSteps", () => {
  it("does not call a job Completed on the relay's word alone", () => {
    const { steps, completed } = buildSteps(
      job({ status: "completed", completedAt: 1_700_000_000 }),
      {},
      true,
      false,
      true
    );
    expect(completed).toBe(false);
    // Nothing past Generating is proven, so the frontier is the commitment
    // and both Completed and Settled stay grey.
    expect(stateOf(steps, "committed")).toBe("active");
    expect(stateOf(steps, "completed")).toBe("pending");
    expect(stateOf(steps, "settled")).toBe("pending");
  });

  it("leaves Completed active, narrating, while the chain catches up", () => {
    const ev: Evidence = { responseCommitted: true };
    const { steps } = buildSteps(
      job({ status: "completed", completedAt: 1_700_000_000 }),
      ev,
      true,
      false,
      true
    );
    const step = steps.find((s) => s.key === "completed");
    expect(step?.state).toBe("active");
    expect(step?.note).toBe("finalizing on chain");
  });

  it("marks Completed, not Settled, when getJob reads state 2", () => {
    const ev: Evidence = { jobState: 2 };
    const { steps, completed } = buildSteps(job(), ev, true, false, false);
    expect(completed).toBe(true);
    expect(stateOf(steps, "completed")).toBe("done");
    expect(stateOf(steps, "settled")).toBe("pending");
    expect(steps.find((s) => s.key === "settled")?.note).toBe(
      "awaiting the dispute window"
    );
  });

  it("marks Completed from the JobCompleted log and links its transaction", () => {
    const ev: Evidence = { completed: { txHash: "0xabc" } };
    const { steps } = buildSteps(job(), ev, true, false, false);
    expect(stateOf(steps, "completed")).toBe("done");
    expect(steps.find((s) => s.key === "completed")?.txHash).toBe("0xabc");
  });

  it("marks Settled only when the fee reached its final owner", () => {
    for (const state of [5, 6]) {
      const { steps } = buildSteps(
        job(),
        { jobState: state },
        true,
        false,
        false
      );
      expect(stateOf(steps, "completed")).toBe("done");
      expect(stateOf(steps, "settled")).toBe("done");
    }
  });

  it("backfills earlier steps from a later observed milestone", () => {
    const { steps } = buildSteps(
      undefined,
      { jobState: 2 },
      false,
      false,
      false
    );
    for (const key of [
      "requested",
      "worker",
      "session",
      "submitted",
      "acknowledged",
      "generating",
      "committed",
    ]) {
      expect(stateOf(steps, key)).toBe("done");
    }
  });

  it("never prints the same transaction hash on two steps", () => {
    // "Response committed" and "Completed" both linked completionTx, so the
    // same hash appeared twice one row apart and read as a rendering bug.
    // The blob tx is not surfaced separately, so the hash belongs to
    // Completed alone.
    const ev: Evidence = {
      responseCommitted: true,
      completed: { txHash: "0xabc" },
    };
    const { steps } = buildSteps(job(), ev, true, false, false);

    const hashes = steps.map((s) => s.txHash).filter(Boolean);
    expect(new Set(hashes).size).toBe(hashes.length);
    expect(steps.find((s) => s.key === "committed")?.txHash).toBeUndefined();
    expect(steps.find((s) => s.key === "completed")?.txHash).toBe("0xabc");
  });

  it("gives no step a note that only restates its own label", () => {
    // Dim 10px monospace saying "prompt request sent" under a step called
    // "Requested" is noise: it lengthens the row, breaks the connector
    // rhythm, and tells the reader nothing.
    const { steps } = buildSteps(
      job(),
      { responseCommitted: true, completed: { txHash: "0xabc" } },
      true,
      false,
      false
    );
    for (const step of steps) {
      if (!step.note) continue;
      const label = step.label.toLowerCase().replace(/[^a-z]/g, "");
      const note = step.note.toLowerCase().replace(/[^a-z]/g, "");
      expect(note).not.toBe(label);
      expect(note.startsWith(label)).toBe(false);
    }
  });
});
