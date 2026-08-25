/**
 * Client-side private memory.
 *
 * Memory entries live only in this browser's localStorage — never in the
 * chat database, never on chain, never in any server-side profile. When
 * enabled, the entries are prepended to the prompt inside ProtocolTransport's
 * envelope assembly (sendMessages, via withMemoryPrefix), which runs AFTER the
 * user-message persist has already captured the unmodified message — so
 * memory travels only inside the encrypted envelope of the user's own
 * prompts, and chat history stays clean of it.
 *
 * Default is OFF (enabled: false). Two reasons: privacy-first posture, and
 * quality — a stale memory silently injected into every prompt is a prompt-
 * injection risk against the user's own future questions, so it has to be an
 * explicit opt-in the user can see and edit.
 */

export type MemoryEntry = {
  id: string;
  text: string;
  createdAt: string;
};

export type MemoryStore = {
  /** Master switch. Off = nothing is ever injected, entries are kept. */
  enabled: boolean;
  entries: MemoryEntry[];
};

export const MEMORY_LIMITS = {
  /** Enough for durable facts, small enough to never dominate a prompt. */
  maxEntries: 20,
  /** One fact per entry; long notes belong in the system prompt instead. */
  maxEntryChars: 280,
} as const;

export const EMPTY_MEMORY_STORE: MemoryStore = { enabled: false, entries: [] };

const STORAGE_KEY = "lc-private-memory";

/** SSR / corrupt-storage safe load. Missing storage = default OFF. */
export function loadMemoryStore(): MemoryStore {
  if (typeof window === "undefined") {
    return EMPTY_MEMORY_STORE;
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return EMPTY_MEMORY_STORE;
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return EMPTY_MEMORY_STORE;
    }
    const candidate = parsed as Partial<MemoryStore>;
    return {
      enabled: candidate.enabled === true,
      entries: Array.isArray(candidate.entries)
        ? candidate.entries.filter(
            (e): e is MemoryEntry =>
              !!e &&
              typeof e === "object" &&
              typeof (e as MemoryEntry).id === "string" &&
              typeof (e as MemoryEntry).text === "string"
          )
        : [],
    };
  } catch {
    return EMPTY_MEMORY_STORE;
  }
}

export function saveMemoryStore(store: MemoryStore): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Quota exceeded — memory is best-effort; the session keeps working.
  }
}

/**
 * Add one entry: trimmed, capped per-entry, exact-duplicate rejected, oldest
 * evicted past the cap. Returns the previous store unchanged when the text is
 * empty or already remembered.
 */
export function addMemoryEntry(
  store: MemoryStore,
  text: string,
  id: string,
  now: string
): MemoryStore {
  const trimmed = text.trim().slice(0, MEMORY_LIMITS.maxEntryChars);
  if (!trimmed) {
    return store;
  }
  if (store.entries.some((e) => e.text === trimmed)) {
    return store;
  }
  const entries = [...store.entries, { id, text: trimmed, createdAt: now }];
  if (entries.length > MEMORY_LIMITS.maxEntries) {
    entries.splice(0, entries.length - MEMORY_LIMITS.maxEntries);
  }
  return { ...store, entries };
}

export function removeMemoryEntry(store: MemoryStore, id: string): MemoryStore {
  return { ...store, entries: store.entries.filter((e) => e.id !== id) };
}

/**
 * The prompt prefix. Deliberately labeled as user-provided device memory so
 * the model treats it as context from the user, not as instructions from the
 * system — and so the chat's real system prompt is untouched.
 */
export function buildMemoryPrefix(entries: MemoryEntry[]): string {
  if (entries.length === 0) {
    return "";
  }
  const lines = entries.map((e) => `- ${e.text}`).join("\n");
  return `[Personal memory — facts the user saved on this device]\n${lines}\n[End of personal memory]\n\n`;
}

/** Prefix + prompt, or the prompt untouched when memory is empty. */
export function withMemoryPrefix(prefix: string, prompt: string): string {
  return prefix ? prefix + prompt : prompt;
}

/** What the transport injects: the prefix when enabled, nothing otherwise. */
export function memoryPrefixFromStore(store: MemoryStore): string {
  return store.enabled ? buildMemoryPrefix(store.entries) : "";
}
