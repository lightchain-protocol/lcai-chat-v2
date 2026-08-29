/**
 * Block-explorer link helpers.
 *
 * The base URL comes from NEXT_PUBLIC_EXPLORER_URL (inlined by Next.js at
 * build time) and falls back to the devnet explorer when unset, so a link is
 * always well-formed even on a bare local config.
 */

export const DEFAULT_EXPLORER_URL = "https://explorer.devnet.lightchain.ai";

const TRAILING_SLASHES = /\/+$/;

/** Resolve the explorer base, preferring an explicit override, then env, then default. */
export function explorerBase(override?: string): string {
  const base =
    override || process.env.NEXT_PUBLIC_EXPLORER_URL || DEFAULT_EXPLORER_URL;
  return base.replace(TRAILING_SLASHES, "");
}

export function explorerTxUrl(txHash: string, override?: string): string {
  return `${explorerBase(override)}/tx/${txHash}`;
}

export function explorerAddressUrl(address: string, override?: string): string {
  return `${explorerBase(override)}/address/${address}`;
}
