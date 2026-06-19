"use client";

import { useState } from "react";
import type { AbiFunction, Address, Hex } from "viem";
import { parseEther, toFunctionSelector } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { useAccount } from "wagmi";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { jobRegistryAbi } from "@/contracts/job-registry-abi";
import { sessionManagerAbi } from "@/contracts/session-manager-abi";
import { useAccountMode } from "@/hooks/use-account-mode";
import useWeb3Clients from "@/hooks/use-web3-clients";
import {
  clearDelegateKey,
  generateDelegateKey,
  storeDelegateKey,
} from "@/lib/protocol/delegate-key";
import type { RegisterSessionKeyPolicy } from "@/lib/protocol/delegation";
import {
  signDelegationAuthorization,
  signRegisterSessionKey,
} from "@/lib/protocol/delegation";
import { GatewayAuth } from "@/lib/protocol/gateway-auth";
import { GatewayClient } from "@/lib/protocol/gateway-client";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;
const DEV_MODE = process.env.NEXT_PUBLIC_AA_DEV_MODE === "true";
const THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60;
const REGISTER_DEADLINE_SECONDS = 60 * 60;
// Generous per-key native-spend ceiling. The user can revoke at any time and
// every op is selector-scoped, so this is a safety cap, not a budget.
const SPENDING_CAP = parseEther("0.5");
const POLL_TRIES = 30;
const POLL_DELAY_MS = 1000;
const PRIVATE_KEY_RE = /^0x[0-9a-fA-F]{64}$/;

const PERMITTED_FUNCTIONS = [
  "createSession",
  "submitJob",
  "reassignSession",
  "updateSessionKey",
] as const;

function jobRegistrySelectors(): Hex[] {
  return PERMITTED_FUNCTIONS.map((name) => {
    const item = jobRegistryAbi.find(
      (entry) => entry.type === "function" && entry.name === name
    );
    if (!item) {
      throw new Error(`jobRegistryAbi is missing ${name}`);
    }
    return toFunctionSelector(item as AbiFunction);
  });
}

async function poll<T>(
  fn: () => Promise<T>,
  done: (value: T) => boolean
): Promise<boolean> {
  for (let i = 0; i < POLL_TRIES; i++) {
    const value = await fn();
    if (done(value)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_DELAY_MS));
  }
  return false;
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * Onboarding dialog for the EIP-7702 delegated (gasless) flow.
 *
 *   enable  : (dev) activate delegation → register a delegate key (1 popup)
 *   disable : (dev) revoke delegation → clear the local key
 *
 * Injected wallets cannot yet sign 7702 authorization tuples, so activation /
 * revocation is gated behind NEXT_PUBLIC_AA_DEV_MODE and a pasted devnet key
 * that is asserted against the connected account and discarded immediately.
 * Everything after activation (RegisterSessionKey) is `eth_signTypedData_v4`
 * and works in any wallet.
 */
export function EnableDelegationDialog({ open, onOpenChange }: Props) {
  const { address } = useAccount();
  const { publicClient, walletClient } = useWeb3Clients();
  const { mode, hasDelegateKey, aaConfig, refresh } = useAccountMode();
  const [devKey, setDevKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isDelegated = mode === "delegated";

  async function getConfig() {
    const gateway = new GatewayClient(undefined, new GatewayAuth());
    const cfg = aaConfig ?? (await gateway.getAaConfig());
    return { gateway, cfg };
  }

  function assertDevKeyMatches(userEoa: Address): Hex {
    if (!DEV_MODE) {
      throw new Error(
        "Delegation requires wallet EIP-7702 support — coming soon"
      );
    }
    const pk = devKey.trim() as Hex;
    if (!PRIVATE_KEY_RE.test(pk)) {
      throw new Error("Paste a 32-byte account private key (dev mode only)");
    }
    if (
      privateKeyToAccount(pk).address.toLowerCase() !== userEoa.toLowerCase()
    ) {
      throw new Error("Pasted key does not match the connected account");
    }
    return pk;
  }

  async function handleEnable() {
    setBusy(true);
    setError(null);
    try {
      if (!(address && publicClient && walletClient?.account)) {
        throw new Error("Wallet not connected");
      }
      const userEoa = address as Address;
      const { gateway, cfg } = await getConfig();
      if (!cfg.sessionManagerImpl) {
        throw new Error("SessionManager is not deployed on this network");
      }
      if (!(cfg.sessionManagerName && cfg.sessionManagerVersion)) {
        throw new Error("SessionManager EIP-712 domain missing from config");
      }

      // 1. Ensure the account is delegated (dev-mode authorization broadcast).
      if (mode !== "delegated") {
        const pk = assertDevKeyMatches(userEoa);
        const nonce = await publicClient.getTransactionCount({
          address: userEoa,
        });
        const auth = await signDelegationAuthorization(pk, {
          sessionManagerImpl: cfg.sessionManagerImpl as Address,
          chainId: cfg.chainId,
          nonce,
        });
        setDevKey(""); // discard the pasted key immediately
        await gateway.activateDelegation(auth);
        const ok = await poll(
          () => gateway.getAccountMode(userEoa),
          (m) => m.mode === "delegated"
        );
        if (!ok) {
          throw new Error("Delegation did not activate — please retry");
        }
      }

      // 2. Generate + register a scoped delegate key (the single wallet popup).
      const delegate = generateDelegateKey();
      const registrationNonce = (await publicClient.readContract({
        address: userEoa,
        abi: sessionManagerAbi,
        functionName: "getRegistrationNonce",
      })) as bigint;
      const now = Math.floor(Date.now() / 1000);
      const policy: RegisterSessionKeyPolicy = {
        validUntil: now + THIRTY_DAYS_SECONDS,
        validAfter: 0,
        spendingLimit: SPENDING_CAP,
        permissions: [
          {
            target: cfg.jobRegistry as Address,
            selectors: jobRegistrySelectors(),
          },
        ],
      };
      const deadline = BigInt(now + REGISTER_DEADLINE_SECONDS);
      const sig = await signRegisterSessionKey(
        walletClient,
        walletClient.account,
        {
          name: cfg.sessionManagerName,
          version: cfg.sessionManagerVersion,
          chainId: cfg.chainId,
          verifyingContract: userEoa,
        },
        { sessionKey: delegate.address, policy, registrationNonce, deadline }
      );
      await gateway.relayRekey({
        user: userEoa,
        sessionKey: delegate.address,
        policy,
        registrationNonce,
        deadline,
        sig,
      });
      const registered = await poll(
        () =>
          publicClient.readContract({
            address: userEoa,
            abi: sessionManagerAbi,
            functionName: "hasSessionKey",
            args: [delegate.address],
          }) as Promise<boolean>,
        (v) => v === true
      );
      if (!registered) {
        throw new Error("Delegate key was not registered — please retry");
      }
      storeDelegateKey(cfg.chainId, userEoa, delegate.privateKey);
      await refresh();
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleDisable() {
    setBusy(true);
    setError(null);
    try {
      if (!(address && publicClient)) {
        throw new Error("Wallet not connected");
      }
      const userEoa = address as Address;
      const { gateway, cfg } = await getConfig();
      const pk = assertDevKeyMatches(userEoa);
      const nonce = await publicClient.getTransactionCount({
        address: userEoa,
      });
      const auth = await signDelegationAuthorization(pk, {
        sessionManagerImpl: ZERO_ADDRESS,
        chainId: cfg.chainId,
        nonce,
      });
      setDevKey("");
      await gateway.revokeDelegation(auth);
      clearDelegateKey(cfg.chainId, userEoa);
      await poll(
        () => gateway.getAccountMode(userEoa),
        (m) => m.mode === "direct"
      );
      await refresh();
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Gasless prompts (account abstraction)</DialogTitle>
          <DialogDescription>
            Delegate to the LightChain SessionManager so prompts are signed by a
            scoped browser key and relayed for you — fees come from your wallet
            balance, with no per-prompt popups.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 text-sm">
          <p>
            Status:{" "}
            <span className="font-mono">
              {mode}
              {hasDelegateKey ? " + key" : ""}
            </span>
          </p>
          {mode === "unsupported_delegation" && (
            <p className="text-amber-600">
              This account is delegated to a different implementation. Disable
              it before using LightChain account abstraction.
            </p>
          )}
          {DEV_MODE && (
            <Input
              autoComplete="off"
              onChange={(e) => setDevKey(e.target.value)}
              placeholder="Dev mode: account private key (0x…) — discarded after signing"
              type="password"
              value={devKey}
            />
          )}
          {!DEV_MODE && !isDelegated && (
            <p className="text-muted-foreground">
              Enabling delegation requires a wallet with EIP-7702 support —
              coming soon.
            </p>
          )}
          {error && <p className="text-red-500">{error}</p>}
        </div>

        <DialogFooter>
          {isDelegated && hasDelegateKey ? (
            <Button
              disabled={busy}
              onClick={handleDisable}
              variant="destructive"
            >
              {busy ? "Working…" : "Disable gasless mode"}
            </Button>
          ) : (
            <Button
              disabled={busy || (!DEV_MODE && !isDelegated)}
              onClick={handleEnable}
            >
              {busy ? "Working…" : "Enable gasless mode"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
