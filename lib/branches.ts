/**
 * Conversation branching — a device-local view layer over the flat message
 * list.
 *
 * The database stores messages as one flat, append-only list per chat (no
 * parentMessageId), so branches live in localStorage: forking at a message
 * snapshots everything below it as a switchable branch, and the flat server
 * list keeps every branch's messages. On reload, applyActiveBranches filters
 * the server list down to each anchor's active branch — message ids are
 * stable, so membership filtering reconstructs the exact branched view. On a
 * different device (no store) the chat shows the full flat history, which is
 * why the navigator tooltip says branches live on this device.
 *
 * Model: each anchor message owns an ordered list of branch tails plus an
 * activeIndex pointing at the tail currently on screen. The visible tail is
 * only snapshotted into its slot when the user switches away from it (or
 * forks again), so the in-progress branch costs no bookkeeping per message.
 */

import type { ChatMessage } from "./types";

export type StoredBranchMessage = Pick<
  ChatMessage,
  "id" | "role" | "parts" | "metadata"
>;

export type Branch = {
  messages: StoredBranchMessage[];
  createdAt: string;
};

export type AnchorBranches = {
  branches: Branch[];
  activeIndex: number;
};

/** Keyed by anchor message id. */
export type BranchStore = Record<string, AnchorBranches>;

const storageKey = (chatId: string) => `lc-chat-branches:${chatId}`;

/** SSR / corrupt-storage safe load. */
export function loadBranchStore(chatId: string): BranchStore {
  if (typeof window === "undefined") {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(storageKey(chatId));
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed as BranchStore;
  } catch {
    return {};
  }
}

/** Best-effort save; a full quota drops the update rather than breaking chat. */
export function saveBranchStore(chatId: string, store: BranchStore): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(storageKey(chatId), JSON.stringify(store));
  } catch {
    // Quota exceeded — the live view still works, the branch just won't
    // survive a reload. Surfaced via the store being unchanged on next load.
  }
}

const snapshotTail = (tail: ChatMessage[]): StoredBranchMessage[] =>
  tail.map((m) => ({
    id: m.id,
    role: m.role,
    parts: m.parts,
    metadata: m.metadata,
  }));

/**
 * Fork below `anchorId`: the current tail becomes branch 1 and a new empty
 * branch 2 becomes active (the caller truncates the view to the anchor).
 * Forking an anchor that already has branches snapshots the live tail as the
 * newest branch instead of clobbering existing ones.
 */
export function forkAt(
  store: BranchStore,
  anchorId: string,
  currentTail: ChatMessage[],
  now: string
): BranchStore {
  const existing = store[anchorId];
  if (existing) {
    return addBranch(store, anchorId, currentTail, now);
  }
  return {
    ...store,
    [anchorId]: {
      branches: [
        { messages: snapshotTail(currentTail), createdAt: now },
        { messages: [], createdAt: now },
      ],
      activeIndex: 1,
    },
  };
}

/**
 * Switch the visible branch: snapshot the live tail into the active slot,
 * then hand back the target tail for the caller to display.
 */
// biome-ignore lint/nursery/useMaxParams: positional args mirror forkAt/addBranch; an options object would churn every call site for one extra param.
export function switchBranch(
  store: BranchStore,
  anchorId: string,
  targetIndex: number,
  currentTail: ChatMessage[],
  now: string
): { store: BranchStore; tail: StoredBranchMessage[] } {
  const entry = store[anchorId];
  if (!entry || targetIndex < 0 || targetIndex >= entry.branches.length) {
    return { store, tail: snapshotTail(currentTail) };
  }
  const branches = entry.branches.map((branch, i) =>
    i === entry.activeIndex
      ? { messages: snapshotTail(currentTail), createdAt: branch.createdAt }
      : branch
  );
  return {
    store: {
      ...store,
      [anchorId]: { branches, activeIndex: targetIndex },
    },
    tail: branches[targetIndex].messages,
  };
}

/**
 * Open another empty branch on an anchor that already has branches: snapshot
 * the live tail into the active slot, append an empty branch, activate it.
 */
export function addBranch(
  store: BranchStore,
  anchorId: string,
  currentTail: ChatMessage[],
  now: string
): BranchStore {
  const entry = store[anchorId];
  if (!entry) {
    return store;
  }
  const branches = entry.branches.map((branch, i) =>
    i === entry.activeIndex
      ? { messages: snapshotTail(currentTail), createdAt: branch.createdAt }
      : branch
  );
  branches.push({ messages: [], createdAt: now });
  return {
    ...store,
    [anchorId]: { branches, activeIndex: branches.length - 1 },
  };
}

/**
 * Rebuild the branched view from the flat server list after a reload: drop
 * every message that belongs to a non-active branch tail. Messages in the
 * active tail — and anything sent after the fork that was never snapshotted
 * — stay, because they appear in no non-active tail.
 */
export function applyActiveBranches(
  messages: ChatMessage[],
  store: BranchStore
): ChatMessage[] {
  const hiddenIds = new Set<string>();
  for (const entry of Object.values(store)) {
    entry.branches.forEach((branch, i) => {
      if (i === entry.activeIndex) {
        return;
      }
      for (const m of branch.messages) {
        hiddenIds.add(m.id);
      }
    });
  }
  if (hiddenIds.size === 0) {
    return messages;
  }
  return messages.filter((m) => !hiddenIds.has(m.id));
}
