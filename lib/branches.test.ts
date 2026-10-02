import { describe, expect, it } from "vitest";
import {
  addBranch,
  applyActiveBranches,
  type BranchStore,
  forkAt,
  switchBranch,
} from "./branches";
import type { ChatMessage } from "./types";

const msg = (id: string, role: "user" | "assistant" = "assistant") =>
  ({
    id,
    role,
    parts: [{ type: "text", text: `message ${id}` }],
    metadata: { createdAt: "2026-08-22T00:00:00.000Z" },
  }) as ChatMessage;

describe("forkAt", () => {
  it("snapshots the current tail as branch 1 and activates an empty branch 2", () => {
    const store = forkAt({}, "anchor", [msg("a"), msg("b")], "now");
    const entry = store.anchor;
    expect(entry.branches).toHaveLength(2);
    expect(entry.branches[0].messages.map((m) => m.id)).toEqual(["a", "b"]);
    expect(entry.branches[1].messages).toEqual([]);
    expect(entry.activeIndex).toBe(1);
  });

  it("forking an existing anchor adds a branch instead of clobbering", () => {
    let store = forkAt({}, "anchor", [msg("a")], "t1");
    store = forkAt(store, "anchor", [msg("x")], "t2");
    expect(store.anchor.branches).toHaveLength(3);
    expect(store.anchor.activeIndex).toBe(2);
    // The live tail at second-fork time was snapshotted into branch 2's slot.
    expect(store.anchor.branches[1].messages.map((m) => m.id)).toEqual(["x"]);
  });
});

describe("switchBranch", () => {
  it("snapshots the live tail into the active slot and returns the target tail", () => {
    let store = forkAt({}, "anchor", [msg("a")], "t1");
    // Live tail grew in branch 2 (activeIndex 1).
    const result = switchBranch(
      store,
      "anchor",
      0,
      [msg("b1"), msg("b2")],
      "t2"
    );
    store = result.store;
    expect(store.anchor.activeIndex).toBe(0);
    expect(store.anchor.branches[1].messages.map((m) => m.id)).toEqual([
      "b1",
      "b2",
    ]);
    expect(result.tail.map((m) => m.id)).toEqual(["a"]);
  });

  it("rejects out-of-range targets without mutating the store", () => {
    const store = forkAt({}, "anchor", [msg("a")], "t1");
    const result = switchBranch(store, "anchor", 7, [msg("live")], "t2");
    expect(result.store).toBe(store);
    expect(result.tail.map((m) => m.id)).toEqual(["live"]);
  });
});

describe("addBranch", () => {
  it("appends an empty branch and activates it", () => {
    let store = forkAt({}, "anchor", [msg("a")], "t1");
    store = addBranch(store, "anchor", [msg("b1")], "t2");
    expect(store.anchor.branches).toHaveLength(3);
    expect(store.anchor.activeIndex).toBe(2);
    expect(store.anchor.branches[1].messages.map((m) => m.id)).toEqual(["b1"]);
  });

  it("is a no-op on an unknown anchor", () => {
    const store: BranchStore = {};
    expect(addBranch(store, "nope", [msg("a")], "t")).toBe(store);
  });
});

describe("applyActiveBranches", () => {
  it("hides non-active branch tails but keeps the active one and new messages", () => {
    // Server list after: fork below "anchor" (tail a), two new prompts in
    // branch 2 (b1, b2), then switch back to branch 1 and send one more (c1).
    const store = forkAt({}, "anchor", [msg("a")], "t1");
    const switched = switchBranch(
      store,
      "anchor",
      0,
      [msg("b1"), msg("b2")],
      "t2"
    );
    const flat = [
      msg("u1", "user"),
      msg("anchor"),
      msg("a"),
      msg("b1"),
      msg("b2"),
      msg("c1"),
    ];
    const view = applyActiveBranches(flat, switched.store);
    expect(view.map((m) => m.id)).toEqual(["u1", "anchor", "a", "c1"]);
  });

  it("returns the list untouched when there are no branches", () => {
    const flat = [msg("u1", "user"), msg("a")];
    expect(applyActiveBranches(flat, {})).toBe(flat);
  });

  it("handles nested anchors by union removal", () => {
    let store = forkAt({}, "outer", [msg("o1")], "t1");
    store = forkAt(store, "inner", [msg("i1")], "t2");
    const flat = [msg("outer"), msg("o1"), msg("inner"), msg("i1"), msg("new")];
    // Both anchors active on their newest (empty) branch: both old tails hide.
    const view = applyActiveBranches(flat, store);
    expect(view.map((m) => m.id)).toEqual(["outer", "inner", "new"]);
  });
});
