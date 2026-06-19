"use client";

import { useCallback, useEffect, useState } from "react";
import type { Address } from "viem";
import { useAccount } from "wagmi";
import config from "@/config";
import { loadDelegateKey } from "@/lib/protocol/delegate-key";
import { GatewayAuth } from "@/lib/protocol/gateway-auth";
import type { AaConfigResponse } from "@/lib/protocol/gateway-client";
import { GatewayClient } from "@/lib/protocol/gateway-client";

export type AccountMode =
  | "direct"
  | "delegated"
  | "unsupported_delegation"
  | "unknown";

export type AccountModeState = {
  /** On-chain delegation classification for the connected account. */
  mode: AccountMode;
  /** Whether a usable delegate key is stored locally for this account. */
  hasDelegateKey: boolean;
  /** Public AA config (chain id + SessionManager domain), or null. */
  aaConfig: AaConfigResponse | null;
  loading: boolean;
  refresh: () => Promise<void>;
};

/**
 * Tracks whether the connected account is on the direct (wallet-signed) or
 * delegated (gasless) path, plus whether a delegate key is present locally.
 * The enable-delegation dialog drives transitions; everything else reads this.
 */
export function useAccountMode(): AccountModeState {
  const { address } = useAccount();
  const chainId = config.chains[0].id;
  const [mode, setMode] = useState<AccountMode>("unknown");
  const [aaConfig, setAaConfig] = useState<AaConfigResponse | null>(null);
  const [hasDelegateKey, setHasDelegateKey] = useState(false);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!address) {
      setMode("unknown");
      setHasDelegateKey(false);
      return;
    }
    setLoading(true);
    try {
      const gateway = new GatewayClient(undefined, new GatewayAuth());
      const [modeRes, cfg] = await Promise.all([
        gateway.getAccountMode(address),
        gateway.getAaConfig().catch(() => null),
      ]);
      setMode(modeRes.mode);
      setAaConfig(cfg);
      setHasDelegateKey(loadDelegateKey(chainId, address as Address) !== null);
    } catch {
      setMode("unknown");
    } finally {
      setLoading(false);
    }
  }, [address, chainId]);

  useEffect(() => {
    refresh().catch(() => {
      // refresh swallows its own errors; nothing to do here.
    });
  }, [refresh]);

  return { mode, hasDelegateKey, aaConfig, loading, refresh };
}
