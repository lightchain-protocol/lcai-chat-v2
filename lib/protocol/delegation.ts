/**
 * EIP-712 typed-data builders + signers for the EIP-7702 delegated flow.
 *
 * The type definitions here MUST match SessionManager's on-chain encoding and
 * the consumer-api `session-key-op.service.ts` envelopes byte-for-byte (the
 * contract's golden-vector test pins them against viem). The domain's
 * `verifyingContract` is the user's EOA — under 7702 the SessionManager code
 * runs as the EOA, so every signature is bound to one specific account.
 */
import type { Account, Address, Hex, WalletClient } from "viem";
import { keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export type AaDomain = {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: Address;
};

export type SessionKeyOp = {
  target: Address;
  data: Hex;
  value: bigint;
  nonce: bigint;
  deadline: bigint;
  maxGasCost: bigint;
};

export type TargetPermission = {
  target: Address;
  selectors: Hex[];
};

export type RegisterSessionKeyPolicy = {
  validUntil: number;
  validAfter: number;
  spendingLimit: bigint;
  permissions: TargetPermission[];
};

const SESSION_KEY_OP_TYPES = {
  SessionKeyOp: [
    { name: "target", type: "address" },
    { name: "dataHash", type: "bytes32" },
    { name: "value", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
    { name: "maxGasCost", type: "uint256" },
  ],
} as const;

const REGISTER_SESSION_KEY_TYPES = {
  RegisterSessionKey: [
    { name: "sessionKey", type: "address" },
    { name: "validUntil", type: "uint48" },
    { name: "validAfter", type: "uint48" },
    { name: "spendingLimit", type: "uint256" },
    { name: "permissions", type: "TargetPermission[]" },
    { name: "registrationNonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
  TargetPermission: [
    { name: "target", type: "address" },
    { name: "selectors", type: "bytes4[]" },
  ],
} as const;

/**
 * Sign a `SessionKeyOp` with the browser-held delegate key. No wallet popup —
 * this is the per-prompt hot path. `dataHash = keccak256(data)` binds the
 * exact calldata the user authorized.
 */
export function signSessionKeyOp(
  delegatePrivateKey: Hex,
  domain: AaDomain,
  op: SessionKeyOp
): Promise<Hex> {
  const account = privateKeyToAccount(delegatePrivateKey);
  return account.signTypedData({
    domain,
    types: SESSION_KEY_OP_TYPES,
    primaryType: "SessionKeyOp",
    message: {
      target: op.target,
      dataHash: keccak256(op.data),
      value: op.value,
      nonce: op.nonce,
      deadline: op.deadline,
      maxGasCost: op.maxGasCost,
    },
  });
}

/**
 * Sign a `RegisterSessionKey` envelope with the user's ROOT wallet key. This
 * is the single onboarding popup (`eth_signTypedData_v4`, supported by every
 * wallet). The recovered signer must equal the EOA itself on chain.
 */
export function signRegisterSessionKey(
  walletClient: WalletClient,
  account: Account,
  domain: AaDomain,
  params: {
    sessionKey: Address;
    policy: RegisterSessionKeyPolicy;
    registrationNonce: bigint;
    deadline: bigint;
  }
): Promise<Hex> {
  return walletClient.signTypedData({
    account,
    domain,
    types: REGISTER_SESSION_KEY_TYPES,
    primaryType: "RegisterSessionKey",
    message: {
      sessionKey: params.sessionKey,
      validUntil: params.policy.validUntil,
      validAfter: params.policy.validAfter,
      spendingLimit: params.policy.spendingLimit,
      permissions: params.policy.permissions,
      registrationNonce: params.registrationNonce,
      deadline: params.deadline,
    },
  });
}

export type SignedDelegationAuthorization = {
  chainId: number;
  address: Address;
  nonce: number;
  r: Hex;
  s: Hex;
  yParity: 0 | 1;
};

/**
 * Sign an EIP-7702 SetCode authorization tuple with a LOCAL private key
 * (dev-mode only — injected wallets cannot yet sign authorization tuples).
 *
 * `nonce` MUST be the EOA's current `latest` transaction count: the gateway
 * executes the type-4 tx, so the authorization carries the account's current
 * nonce (not +1). The pasted key is used here and then discarded by the caller
 * — it is never persisted.
 */
export async function signDelegationAuthorization(
  devPrivateKey: Hex,
  params: { sessionManagerImpl: Address; chainId: number; nonce: number }
): Promise<SignedDelegationAuthorization> {
  const account = privateKeyToAccount(devPrivateKey);
  const auth = await account.signAuthorization({
    contractAddress: params.sessionManagerImpl,
    chainId: params.chainId,
    nonce: params.nonce,
  });
  return {
    chainId: params.chainId,
    address: params.sessionManagerImpl,
    nonce: params.nonce,
    r: auth.r,
    s: auth.s,
    yParity: (auth.yParity ?? (auth.v === 27n ? 0 : 1)) as 0 | 1,
  };
}
