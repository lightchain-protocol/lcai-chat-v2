/**
 * TxSender abstracts "send a contract call and wait for its receipt" so the
 * SessionManager write paths work identically whether the user signs each tx
 * in their wallet (direct) or the gateway relays a session-key-signed envelope
 * (delegated / gasless).
 *
 * Both senders return the mined receipt. The callers parse protocol events
 * (SessionCreated / JobSubmitted / ...) from `receipt.logs` — those inner
 * events appear in the relay tx's receipt too, so the parsing is unchanged.
 */
import type {
  Abi,
  Address,
  Hex,
  PublicClient,
  TransactionReceipt,
  WalletClient,
} from "viem";
import { encodeFunctionData } from "viem";

import { sessionManagerAbi } from "@/contracts/session-manager-abi";

import type { DelegateKey } from "./delegate-key";
import { signSessionKeyOp } from "./delegation";
import { type GatewayClient, GatewayClientError } from "./gateway-client";

/** Mirrors the gateway's `RELAY_TX_GAS_LIMIT` so the user-signed gas ceiling
 *  covers the relay tx the gateway will actually broadcast. */
const RELAY_TX_GAS_LIMIT = 500_000n;
const OP_DEADLINE_SECONDS = 300;
const GAS_BUFFER_NUM = 120n;
const GAS_BUFFER_DEN = 100n;
const DEFAULT_MAX_FEE_PER_GAS = 1_000_000_000n;
const RELAY_REKEY_REASONS =
  /Key(Expired|NotYetValid)|SpendingLimit|InvalidNonce/i;

export type ContractCall = {
  address: Address;
  abi: Abi;
  functionName: string;
  args: readonly unknown[];
  value?: bigint;
};

export type SendResult = {
  hash: Hex;
  receipt: TransactionReceipt;
};

export type TxSender = {
  sendContractCall(call: ContractCall): Promise<SendResult>;
};

/**
 * Thrown when the gateway rejects a relayed op in a way that indicates the
 * delegate key is no longer usable (expired, revoked, or over its spending
 * limit). The session layer maps this to a re-key prompt.
 */
export class DelegateKeyExpiredError extends Error {
  constructor(message = "Delegate key expired or over limit; re-key required") {
    super(message);
    this.name = "DelegateKeyExpiredError";
  }
}

/**
 * Direct path: the user's wallet signs each transaction. Preserves the
 * original estimate→simulate→write→wait sequence (incl. the 20% gas buffer
 * that avoids the ReentrancyGuardTransient cleanup OOG on Anvil).
 */
export class WalletTxSender implements TxSender {
  private readonly walletClient: WalletClient;
  private readonly publicClient: PublicClient;

  constructor(walletClient: WalletClient, publicClient: PublicClient) {
    this.walletClient = walletClient;
    this.publicClient = publicClient;
  }

  async sendContractCall(call: ContractCall): Promise<SendResult> {
    const account = this.walletClient.account;
    if (!account) {
      throw new Error("Wallet account not available");
    }

    const base = {
      account,
      address: call.address,
      abi: call.abi,
      functionName: call.functionName,
      args: call.args,
      ...(call.value === undefined ? {} : { value: call.value }),
      // biome-ignore lint/suspicious/noExplicitAny: a generic Abi erases viem's per-call typing; runtime is sound.
    } as any;

    const gasEstimate = await this.publicClient.estimateContractGas(base);
    const { request } = await this.publicClient.simulateContract({
      ...base,
      gas: (gasEstimate * GAS_BUFFER_NUM) / GAS_BUFFER_DEN,
    });
    // biome-ignore lint/suspicious/noExplicitAny: simulate's request union is erased by the cast above.
    const hash = await this.walletClient.writeContract(request as any);
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    return { hash, receipt };
  }
}

type DelegatedTxSenderOptions = {
  publicClient: PublicClient;
  gateway: GatewayClient;
  userEoa: Address;
  delegate: DelegateKey;
  domain: { name: string; version: string; chainId: number };
};

/**
 * Delegated path: encode the call, sign a `SessionKeyOp` with the delegate key
 * (no popup), and POST it to the gateway relay. The gateway broadcasts
 * `validateAndExecute` on the user's EOA, paying gas up front and being
 * reimbursed from the user's balance up to the signed `maxGasCost`.
 */
export class DelegatedTxSender implements TxSender {
  private readonly opts: DelegatedTxSenderOptions;

  constructor(opts: DelegatedTxSenderOptions) {
    this.opts = opts;
  }

  async sendContractCall(call: ContractCall): Promise<SendResult> {
    const { publicClient, gateway, userEoa, delegate, domain } = this.opts;

    const data = encodeFunctionData({
      abi: call.abi,
      functionName: call.functionName,
      args: call.args,
      // biome-ignore lint/suspicious/noExplicitAny: a generic Abi erases viem's per-call typing.
    } as any);

    // Per-key replay nonce is public chain state on the user's EOA.
    const nonce = (await publicClient.readContract({
      address: userEoa,
      abi: sessionManagerAbi,
      functionName: "getSessionKeyNonce",
      args: [delegate.address],
    })) as bigint;

    const fees = await publicClient.estimateFeesPerGas();
    const maxFeePerGas = fees.maxFeePerGas ?? DEFAULT_MAX_FEE_PER_GAS;
    const maxGasCost = (RELAY_TX_GAS_LIMIT * maxFeePerGas * 3n) / 2n;
    const deadline = BigInt(
      Math.floor(Date.now() / 1000) + OP_DEADLINE_SECONDS
    );

    const op = {
      target: call.address,
      data,
      value: call.value ?? 0n,
      nonce,
      deadline,
      maxGasCost,
    };

    const sig = await signSessionKeyOp(
      delegate.privateKey,
      { ...domain, verifyingContract: userEoa },
      op
    );

    let txHash: Hex;
    try {
      const res = await gateway.relaySessionKeyOp({ user: userEoa, op, sig });
      txHash = res.txHash as Hex;
    } catch (err) {
      throw mapRelayError(err);
    }

    const receipt = await publicClient.waitForTransactionReceipt({
      hash: txHash,
    });
    return { hash: txHash, receipt };
  }
}

/**
 * Map a relay rejection to a delegate-key-expired signal when the shape
 * indicates the key is no longer usable (bad signature, or a simulation revert
 * caused by key expiry / spending limit / nonce). Everything else propagates.
 */
function mapRelayError(err: unknown): Error {
  if (err instanceof GatewayClientError) {
    if (err.status === 400) {
      return new DelegateKeyExpiredError();
    }
    if (err.status === 422 && RELAY_REKEY_REASONS.test(err.body)) {
      return new DelegateKeyExpiredError();
    }
  }
  return err instanceof Error ? err : new Error(String(err));
}
