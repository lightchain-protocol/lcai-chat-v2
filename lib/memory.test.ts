import { describe, expect, it } from "vitest";
import {
  addMemoryEntry,
  buildMemoryPrefix,
  EMPTY_MEMORY_STORE,
  MEMORY_LIMITS,
  type MemoryStore,
  memoryPrefixFromStore,
  removeMemoryEntry,
  withMemoryPrefix,
} from "./memory";

const storeWith = (texts: string[]): MemoryStore => ({
  enabled: true,
  entries: texts.map((text, i) => ({
    id: `e${i}`,
    text,
    createdAt: "2026-08-22T00:00:00.000Z",
  })),
});

describe("addMemoryEntry", () => {
  it("trims and appends a new entry", () => {
    const store = addMemoryEntry(
      EMPTY_MEMORY_STORE,
      "  I prefer terse answers  ",
      "e1",
      "now"
    );
    expect(store.entries).toEqual([
      { id: "e1", text: "I prefer terse answers", createdAt: "now" },
    ]);
  });

  it("rejects empty and exact-duplicate text without mutating", () => {
    const store = storeWith(["fact"]);
    expect(addMemoryEntry(store, "   ", "x", "now")).toBe(store);
    expect(addMemoryEntry(store, "fact", "x", "now")).toBe(store);
  });

  it("caps entry length", () => {
    const store = addMemoryEntry(
      EMPTY_MEMORY_STORE,
      "a".repeat(MEMORY_LIMITS.maxEntryChars + 50),
      "e1",
      "now"
    );
    expect(store.entries[0].text).toHaveLength(MEMORY_LIMITS.maxEntryChars);
  });

  it("evicts the oldest entries past the cap", () => {
    let store: MemoryStore = EMPTY_MEMORY_STORE;
    for (let i = 0; i < MEMORY_LIMITS.maxEntries + 3; i++) {
      store = addMemoryEntry(store, `fact ${i}`, `e${i}`, "now");
    }
    expect(store.entries).toHaveLength(MEMORY_LIMITS.maxEntries);
    expect(store.entries[0].text).toBe("fact 3");
    expect(store.entries.at(-1)?.text).toBe(
      `fact ${MEMORY_LIMITS.maxEntries + 2}`
    );
  });
});

describe("removeMemoryEntry", () => {
  it("removes by id and leaves others intact", () => {
    const store = removeMemoryEntry(storeWith(["a", "b", "c"]), "e1");
    expect(store.entries.map((e) => e.text)).toEqual(["a", "c"]);
  });
});

describe("buildMemoryPrefix", () => {
  it("labels the block as user-provided device memory", () => {
    const prefix = buildMemoryPrefix(storeWith(["likes tea"]).entries);
    expect(prefix).toContain("Personal memory");
    expect(prefix).toContain("saved on this device");
    expect(prefix).toContain("- likes tea");
    expect(prefix).toContain("[End of personal memory]");
  });

  it("is empty when there is nothing to remember", () => {
    expect(buildMemoryPrefix([])).toBe("");
  });
});

describe("withMemoryPrefix / memoryPrefixFromStore", () => {
  it("prepends the prefix ahead of the prompt", () => {
    expect(withMemoryPrefix("MEM\n\n", "hello")).toBe("MEM\n\nhello");
  });

  it("returns the prompt untouched when the prefix is empty", () => {
    expect(withMemoryPrefix("", "hello")).toBe("hello");
  });

  it("injects only when the store is enabled", () => {
    const store = storeWith(["likes tea"]);
    expect(memoryPrefixFromStore(store)).toContain("likes tea");
    expect(memoryPrefixFromStore({ ...store, enabled: false })).toBe("");
    expect(memoryPrefixFromStore(EMPTY_MEMORY_STORE)).toBe("");
  });
});
