const TRAILING_ZEROS = /0+$/;

/**
 * Formats a wei amount as LCAI for display.
 *
 * Truncates rather than rounds, and drops trailing zeros, so a flat fee reads
 * as "0.02 LCAI" rather than "0.020000". Six fractional digits is enough to
 * separate the per-job fees in use without turning a price into a hash.
 *
 * Shared because provenance, the transactions panel and the composer must all
 * render the same fee identically — the same number shown two ways reads as
 * two different prices.
 */
export function formatLcai(wei: bigint): string {
  const whole = wei / 10n ** 18n;
  const frac = wei % 10n ** 18n;
  if (frac === 0n) return `${whole} LCAI`;
  const padded = frac.toString().padStart(18, "0").replace(TRAILING_ZEROS, "");
  return `${whole}.${padded.slice(0, 6)} LCAI`;
}
