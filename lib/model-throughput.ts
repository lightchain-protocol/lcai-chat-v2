/**
 * How fast each model has actually been answering, measured on this device.
 *
 * Not a catalogue figure: workers differ enormously — the same model runs at
 * ~4 tok/s on a CPU box and ~95 tok/s on an A100 — so a published number
 * would be fiction for whoever draws the other worker. These are observations
 * from answers this browser really received.
 *
 * Kept locally and never sent anywhere. It exists so the picker can set an
 * expectation before someone commits a fee to a model that may take minutes.
 */

const KEY = "lcai.model-throughput.v1";

/**
 * Enough samples to shrug off one cold model load, few enough that a fleet
 * upgrade is reflected within a handful of messages rather than being
 * averaged away for days.
 */
const MAX_SAMPLES = 7;

type Samples = Record<string, number[]>;

function read(): Samples {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Samples;
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Records one observed throughput for a model.
 *
 * Silently ignores anything non-positive or non-finite: a stats frame that
 * arrives malformed should cost a hint, never a thrown error inside the
 * response path.
 */
export function recordThroughput(
  modelId: string,
  tokensPerSecond: number
): void {
  if (!(Number.isFinite(tokensPerSecond) && tokensPerSecond > 0)) return;
  try {
    const all = read();
    const key = modelId.toLowerCase();
    const next = [...(all[key] ?? []), tokensPerSecond].slice(-MAX_SAMPLES);
    window.localStorage.setItem(KEY, JSON.stringify({ ...all, [key]: next }));
  } catch {
    // Storage unavailable (private windows). The hint is optional.
  }
}

/**
 * The typical throughput seen for a model, or null when there is not enough
 * evidence to say.
 *
 * Median rather than mean: a single cold load takes seconds and would drag an
 * average down far below what the next message will actually do. Two samples
 * minimum, so one unusual answer never becomes "the" speed.
 */
export function typicalThroughput(modelId: string): number | null {
  const samples = read()[modelId.toLowerCase()] ?? [];
  if (samples.length < 2) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * Reader-facing speed, rounded to a precision the number deserves. Below
 * 10 tok/s one decimal is the difference between "slow" and "unusable"; above
 * it, decimals are noise.
 */
export function formatThroughput(tokensPerSecond: number): string {
  return tokensPerSecond < 10
    ? `~${tokensPerSecond.toFixed(1)} tok/s`
    : `~${Math.round(tokensPerSecond)} tok/s`;
}
