/**
 * Which workers this person would rather be served by, or not.
 *
 * Held in the browser, sent with each session request, stored nowhere else.
 * That is the point: sortition decides who may claim, and this only lets
 * someone decline what they drew — no server keeps a list of who may serve
 * whom, so nobody becomes the arbiter of a worker's reputation.
 *
 * A preference is never a guarantee. The consumer-api re-draws a bounded
 * number of times and then answers with whoever claimed, because being
 * answered by a worker you would rather avoid beats not being answered.
 */

const KEY = "lcai.worker-preference.v1";

/** Matches the API's cap, so the client cannot build a list it will truncate. */
export const MAX_AVOIDED_WORKERS = 16;

export type WorkerPreference = {
  avoid: string[];
  /** Undefined = no pin. Only one worker can be pinned at a time. */
  prefer?: string;
};

const EMPTY: WorkerPreference = { avoid: [] };

function normalise(address: string): string {
  return address.toLowerCase();
}

/**
 * Reads the stored preference.
 *
 * Every failure returns the empty preference rather than throwing: storage is
 * unavailable in private windows and some embedded browsers, and losing a
 * preference must never stop someone sending a message.
 */
export function readWorkerPreference(): WorkerPreference {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<WorkerPreference>;
    const avoid = Array.isArray(parsed.avoid)
      ? parsed.avoid.filter((a): a is string => typeof a === "string").map(normalise)
      : [];
    const prefer =
      typeof parsed.prefer === "string" ? normalise(parsed.prefer) : undefined;
    return { avoid: avoid.slice(0, MAX_AVOIDED_WORKERS), prefer };
  } catch {
    return EMPTY;
  }
}

function write(next: WorkerPreference): WorkerPreference {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage refused; the preference applies to this page's lifetime only.
  }
  return next;
}

/** True when this worker is currently on the avoid list. */
export function isAvoided(
  address: string,
  preference: WorkerPreference
): boolean {
  return preference.avoid.includes(normalise(address));
}

/** True when this worker is the pinned one. */
export function isPinned(
  address: string,
  preference: WorkerPreference
): boolean {
  return preference.prefer === normalise(address);
}

/**
 * Adds or removes a worker from the avoid list.
 *
 * Avoiding the pinned worker clears the pin — keeping both would send the API
 * a contradiction it has to resolve, and the wish expressed second is the one
 * that should win.
 */
export function toggleAvoided(address: string): WorkerPreference {
  const current = readWorkerPreference();
  const worker = normalise(address);

  if (current.avoid.includes(worker)) {
    return write({ ...current, avoid: current.avoid.filter((a) => a !== worker) });
  }

  return write({
    prefer: current.prefer === worker ? undefined : current.prefer,
    avoid: [...current.avoid, worker].slice(-MAX_AVOIDED_WORKERS),
  });
}

/**
 * Pins a worker, or unpins if it was already pinned. Pinning also lifts any
 * exclusion on that worker, for the same reason.
 */
export function togglePinned(address: string): WorkerPreference {
  const current = readWorkerPreference();
  const worker = normalise(address);

  if (current.prefer === worker) {
    return write({ ...current, prefer: undefined });
  }

  return write({
    prefer: worker,
    avoid: current.avoid.filter((a) => a !== worker),
  });
}

/**
 * The shape the session request carries, or undefined when there is nothing
 * to ask for — so an untouched client sends exactly what it always did.
 */
export function preferenceRequestFields(
  preference: WorkerPreference = readWorkerPreference()
): { avoidWorkers?: string[]; preferWorker?: string } | undefined {
  const fields: { avoidWorkers?: string[]; preferWorker?: string } = {};
  if (preference.avoid.length > 0) fields.avoidWorkers = preference.avoid;
  if (preference.prefer) fields.preferWorker = preference.prefer;
  return Object.keys(fields).length > 0 ? fields : undefined;
}
