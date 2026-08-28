/**
 * Model availability — a device-local heuristic.
 *
 * Records the outcome of the user's own recent jobs per model (localStorage
 * only, never leaves the browser) and derives a coarse "lately fine / lately
 * flaky / no data" signal for the picker. It says nothing about the network
 * as a whole — the tooltip states exactly that. A real fleet-wide signal
 * (heartbeat-based) is P1-a and deliberately out of scope here.
 */

export type ModelOutcome = "completed" | "failed";

export type Availability = "good" | "shaky" | "unknown";

const STORAGE_KEY = "lc-model-availability";

/** Outcomes kept per model; small enough that one bad streak shows fast. */
const WINDOW = 5;

/** Below this many observations the dot stays "unknown" — two successes prove nothing. */
const MIN_OBSERVATIONS = 3;

type Store = Record<string, ModelOutcome[]>;

function readStore(): Store {
  if (typeof window === "undefined") {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object") {
      return {};
    }
    return parsed as Store;
  } catch {
    return {};
  }
}

export function recordModelOutcome(
  modelId: string,
  outcome: ModelOutcome
): void {
  if (typeof window === "undefined") {
    return;
  }
  const store = readStore();
  const history = [...(store[modelId] ?? []), outcome].slice(-WINDOW);
  store[modelId] = history;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Quota/private mode: the indicator just stays unknown — never block a send.
  }
}

/**
 * "shaky" when the latest outcome failed or failures are ≥40% of the window;
 * "good" with enough clean history; "unknown" when there is too little data
 * to say anything honest.
 */
export function availabilityOf(
  modelId: string,
  store: Store = readStore()
): Availability {
  const history = store[modelId];
  if (!history || history.length < MIN_OBSERVATIONS) {
    return "unknown";
  }
  const failures = history.filter((o) => o === "failed").length;
  if (history.at(-1) === "failed" || failures / history.length >= 0.4) {
    return "shaky";
  }
  return "good";
}
