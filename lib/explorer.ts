/**
 * Block-explorer link helpers.
 *
 * The base URL comes from NEXT_PUBLIC_EXPLORER_URL (inlined by Next.js at
 * build time) and falls back to the devnet explorer when unset, so a link is
 * always well-formed even on a bare local config.
 */

import { getAddress } from "viem";

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

/**
 * A worker's page on the worker explorer, which keys workers by checksummed
 * address. ponytail: the one public explorer; give it an env override like
 * explorerBase's once a devnet runs its own.
 */
export function workerExplorerUrl(
  address: string,
  network: "mainnet" | "testnet"
): string {
  return `https://workers.lightchain.ai/workers/${network}/${getAddress(address)}`;
}
