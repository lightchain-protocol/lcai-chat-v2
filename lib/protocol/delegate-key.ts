/**
 * Browser-held delegate key (a.k.a. session key) for the EIP-7702 delegated
 * flow. This secp256k1 key signs `SessionKeyOp` envelopes so per-prompt
 * transactions need no wallet popup.
 *
 * Storage: localStorage, keyed by chain id + EOA. sessionStorage would force a
 * fresh popup + on-chain rekey in every browser tab; localStorage shares one
 * key across tabs. WebCrypto cannot hold a non-extractable secp256k1 key, so
 * the raw key is necessarily readable — it is deliberately LOW VALUE:
 * selector-scoped, time-bounded, spend-capped, and revocable on chain.
 *
 * Naming note: this is the AA "delegate key", distinct from the AES-256
 * content key in crypto.ts. The wire/API boundary calls it `sessionKey`.
 */
import type { Address, Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

export type DelegateKey = {
  privateKey: Hex;
  address: Address;
};

const PRIVATE_KEY_RE = /^0x[0-9a-fA-F]{64}$/;

function storageKey(chainId: number, eoa: Address): string {
  return `lc-delegate-key:${chainId}:${eoa.toLowerCase()}`;
}

/** Generate a fresh delegate key (not yet registered on chain). */
export function generateDelegateKey(): DelegateKey {
  const privateKey = generatePrivateKey();
  return { privateKey, address: privateKeyToAccount(privateKey).address };
}

/** Persist a delegate key for `(chainId, eoa)`. */
export function storeDelegateKey(
  chainId: number,
  eoa: Address,
  privateKey: Hex
): void {
  try {
    localStorage.setItem(storageKey(chainId, eoa), privateKey);
  } catch {
    // localStorage unavailable (SSR / private mode) — caller keeps the key in
    // memory for this session only.
  }
}

/** Load a stored delegate key, or null if none / malformed / unavailable. */
export function loadDelegateKey(
  chainId: number,
  eoa: Address
): DelegateKey | null {
  try {
    const pk = localStorage.getItem(storageKey(chainId, eoa));
    if (!pk || !PRIVATE_KEY_RE.test(pk)) {
      return null;
    }
    const privateKey = pk as Hex;
    return { privateKey, address: privateKeyToAccount(privateKey).address };
  } catch {
    return null;
  }
}

/** Remove the stored delegate key (on disable / rotation). */
export function clearDelegateKey(chainId: number, eoa: Address): void {
  try {
    localStorage.removeItem(storageKey(chainId, eoa));
  } catch {
    // ignore
  }
}
