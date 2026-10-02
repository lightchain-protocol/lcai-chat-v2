"use client";

import {
  keepPreviousData,
  queryOptions,
  useMutation,
  useQuery,
} from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { useCallback, useMemo } from "react";
import { type Address, getContract, parseEther } from "viem";
import { useAccount } from "wagmi";
import config from "@/config";
import { jobRegistryAbi } from "@/contracts/job-registry-abi";
import { GatewayAuth } from "@/lib/protocol/gateway-auth";
import {
  type BalanceResponse,
  GatewayClient,
  GatewayClientError,
} from "@/lib/protocol/gateway-client";
import useWeb3Clients from "./use-web3-clients";

/** Where the user's prepaid balance stands, as far as the consumer-api has said. */
export type PrepaidStatus =
  | "signed-out"
  | "loading"
  | "available"
  | "unavailable"
  | "error";

/** What to say instead of the balance when there is none to show. */
export const PREPAID_NOTICE = {
  "signed-out": "Sign in with your wallet to see your prepaid balance.",
  unavailable: "Prepaid balance isn't available on this network yet.",
  error: "Couldn't read your prepaid balance. Reload the page to try again.",
} as const;

/**
 * `GET /api/balance` needs the sign-in token, so it waits for one and is keyed
 * on it: a wallet that connects before it signs in fetches once it has, and a
 * renewed or re-signed token fetches again instead of keeping a refusal. The
 * last answer stays up meanwhile; signed out, prepaidStatus ignores it.
 */
export function apiBalanceQueryOptions(address?: string, token?: string) {
  return queryOptions({
    queryKey: ["prepaid-api-balance", address?.toLowerCase(), token],
    enabled: !!address && !!token,
    queryFn: () => new GatewayClient(undefined, new GatewayAuth()).getBalance(),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
}

/**
 * "unavailable" only when this build has no JobRegistry or the consumer-api
 * says the feature is off; no answer yet is "loading", a failed one "error".
 * No token while the session is still being read (first load, or the update
 * that follows a sign-in) is not signed out either. Signed in takes a wallet
 * and a token, the same as the query, so "loading" always has a fetch behind it.
 */
export function prepaidStatus({
  hasContract,
  address,
  token,
  sessionLoading,
  api,
}: {
  hasContract: boolean;
  address?: string;
  token?: string;
  sessionLoading: boolean;
  api: { data?: BalanceResponse; error: unknown };
}): PrepaidStatus {
  if (!hasContract) return "unavailable";
  if (!(address && token)) return sessionLoading ? "loading" : "signed-out";
  if (api.data?.delegate) return "available";
  // The consumer-api's own 503 body, not a proxy's 503 for a down API.
  if (
    api.error instanceof GatewayClientError &&
    api.error.status === 503 &&
    api.error.body.includes('"feature_disabled"')
  ) {
    return "unavailable";
  }
  return api.error ? "error" : "loading";
}

/**
 * Reads + writes the user's prepaid balance, delegate authorization, and
 * per-delegate spending allowance on JobRegistry. Delegate address comes from
 * the consumer-api (`GET /api/balance`).
 *
 * On-chain reads use `config.chains[0]` (the protocol chain).
 */
export default function usePrepaidBalance() {
  const { publicClient, walletClient } = useWeb3Clients();
  const { address } = useAccount();
  const session = useSession();
  const token = session.data?.user?.token;

  const protocolChainId = config.chains[0].id;
  const jobRegistryAddress = config.jobRegistryAddress[protocolChainId];

  const contract = useMemo(
    () =>
      jobRegistryAddress
        ? getContract({
            abi: jobRegistryAbi,
            address: jobRegistryAddress,
            client: { public: publicClient, wallet: walletClient },
          })
        : null,
    [jobRegistryAddress, publicClient, walletClient]
  );

  const apiBalance = useQuery(apiBalanceQueryOptions(address, token));

  const delegateAddress = apiBalance.data?.delegate as Address | undefined;

  const onChainBalance = useQuery({
    queryKey: ["prepaid-balance", address?.toLowerCase(), protocolChainId],
    enabled: !!address && !!contract,
    queryFn: async (): Promise<bigint> => {
      if (!contract || !address) return 0n;
      return (await contract.read.prepaidBalanceOf([
        address as Address,
      ])) as bigint;
    },
  });

  const delegateAuthorized = useQuery({
    queryKey: [
      "prepaid-delegate-authorized",
      address?.toLowerCase(),
      delegateAddress?.toLowerCase(),
      protocolChainId,
    ],
    enabled: !!address && !!contract && !!delegateAddress,
    queryFn: async (): Promise<boolean> => {
      if (!contract || !address || !delegateAddress) return false;
      return (await contract.read.isDelegateAuthorized([
        address as Address,
        delegateAddress,
      ])) as boolean;
    },
  });

  const delegateAllowanceQuery = useQuery({
    queryKey: [
      "prepaid-delegate-allowance",
      address?.toLowerCase(),
      delegateAddress?.toLowerCase(),
      protocolChainId,
    ],
    enabled: !!address && !!contract && !!delegateAddress,
    queryFn: async (): Promise<bigint> => {
      if (!contract || !address || !delegateAddress) return 0n;
      return (await contract.read.delegateAllowance([
        address as Address,
        delegateAddress,
      ])) as bigint;
    },
  });

  const refetchAll = useCallback(() => {
    onChainBalance.refetch();
    delegateAuthorized.refetch();
    delegateAllowanceQuery.refetch();
    apiBalance.refetch();
  }, [onChainBalance, delegateAuthorized, delegateAllowanceQuery, apiBalance]);

  const requireWritable = useCallback(() => {
    if (!contract || !walletClient?.account) {
      throw new Error("Wallet not connected");
    }
    if (!delegateAddress) throw new Error("Delegate address not available");
    return { contract, account: walletClient.account.address as Address };
  }, [contract, walletClient, delegateAddress]);

  /**
   * Deposit + authorize delegate + increase spending allowance by deposit amount.
   * Use for all top-ups so new funds are spendable by the delegate.
   */
  const depositAndAuthorize = useCallback(
    async (amount: string | number) => {
      const { account, contract: c } = requireWritable();
      if (!walletClient) throw new Error("Wallet not connected");
      const value = parseEther(`${amount}`);
      const { request } = await publicClient.simulateContract({
        address: c.address,
        abi: jobRegistryAbi,
        functionName: "depositAndAuthorize",
        args: [delegateAddress!],
        value,
        account,
      });
      const hash = await walletClient.writeContract(request);
      await publicClient.waitForTransactionReceipt({ hash });
      refetchAll();
      return hash;
    },
    [requireWritable, walletClient, publicClient, delegateAddress, refetchAll]
  );

  /** Pull `amount` LCAI back from the prepaid balance to the wallet. */
  const withdrawBalance = useCallback(
    async (amount: string | number) => {
      const { account, contract: c } = requireWritable();
      if (!walletClient) throw new Error("Wallet not connected");
      const wei = parseEther(`${amount}`);
      const { request } = await publicClient.simulateContract({
        address: c.address,
        abi: jobRegistryAbi,
        functionName: "withdrawBalance",
        args: [wei],
        account,
      });
      const hash = await walletClient.writeContract(request);
      await publicClient.waitForTransactionReceipt({ hash });
      refetchAll();
      return hash;
    },
    [requireWritable, walletClient, publicClient, refetchAll]
  );

  const setDelegateAuthorization = useCallback(
    async (authorized: boolean) => {
      const { account, contract: c } = requireWritable();
      if (!walletClient) throw new Error("Wallet not connected");
      const { request } = await publicClient.simulateContract({
        address: c.address,
        abi: jobRegistryAbi,
        functionName: "setDelegateAuthorization",
        args: [delegateAddress!, authorized],
        account,
      });
      const hash = await walletClient.writeContract(request);
      await publicClient.waitForTransactionReceipt({ hash });
      refetchAll();
      return hash;
    },
    [requireWritable, walletClient, publicClient, delegateAddress, refetchAll]
  );

  const setDelegateAllowance = useCallback(
    async (allowanceWei: bigint) => {
      const { account, contract: c } = requireWritable();
      if (!walletClient) throw new Error("Wallet not connected");
      const { request } = await publicClient.simulateContract({
        address: c.address,
        abi: jobRegistryAbi,
        functionName: "setDelegateAllowance",
        args: [delegateAddress!, allowanceWei],
        account,
      });
      const hash = await walletClient.writeContract(request);
      await publicClient.waitForTransactionReceipt({ hash });
      refetchAll();
      return hash;
    },
    [requireWritable, walletClient, publicClient, delegateAddress, refetchAll]
  );

  /** Authorize delegate and cap spend at current prepaid balance. */
  const authorizeDelegate = useCallback(async () => {
    const { account, contract: c } = requireWritable();
    await setDelegateAuthorization(true);
    const bal = (await c.read.prepaidBalanceOf([account])) as bigint;
    if (bal > 0n) {
      await setDelegateAllowance(bal);
    }
  }, [requireWritable, setDelegateAuthorization, setDelegateAllowance]);

  const revokeDelegate = useCallback(
    () => setDelegateAuthorization(false),
    [setDelegateAuthorization]
  );

  /** Raise delegate spending limit to match full prepaid balance. */
  const syncAllowanceToBalance = useCallback(async () => {
    const { account, contract: c } = requireWritable();
    const bal = (await c.read.prepaidBalanceOf([account])) as bigint;
    if (bal === 0n) throw new Error("No prepaid balance to allocate");
    const authorized = (await c.read.isDelegateAuthorized([
      account,
      delegateAddress!,
    ])) as boolean;
    if (!authorized) {
      await setDelegateAuthorization(true);
    }
    await setDelegateAllowance(bal);
  }, [
    requireWritable,
    delegateAddress,
    setDelegateAuthorization,
    setDelegateAllowance,
  ]);

  const depositAndAuthorizeMutation = useMutation({
    mutationFn: depositAndAuthorize,
  });
  const withdrawMutation = useMutation({ mutationFn: withdrawBalance });
  const authorizeMutation = useMutation({ mutationFn: authorizeDelegate });
  const revokeMutation = useMutation({ mutationFn: revokeDelegate });
  const syncAllowanceMutation = useMutation({
    mutationFn: syncAllowanceToBalance,
  });

  const balance = onChainBalance.data ?? 0n;
  const allowance = delegateAllowanceQuery.data ?? 0n;
  const isAuthorized = delegateAuthorized.data ?? false;
  const needsAllowanceSync =
    isAuthorized && balance > 0n && allowance < balance;
  const status = prepaidStatus({
    hasContract: !!contract,
    address,
    token,
    sessionLoading: session.status === "loading",
    api: apiBalance,
  });

  return {
    status,
    available: status === "available",
    balance,
    allowance,
    isAuthorized,
    needsAllowanceSync,
    /** Gas-free prompts: funded, authorized, and delegate has spending headroom. */
    ready: balance > 0n && isAuthorized && allowance > 0n,
    delegateAddress,
    isLoading:
      status === "loading" ||
      onChainBalance.isLoading ||
      delegateAuthorized.isLoading ||
      delegateAllowanceQuery.isLoading,
    refetch: refetchAll,
    queries: {
      onChainBalance,
      delegateAuthorized,
      delegateAllowanceQuery,
      apiBalance,
    },
    depositAndAuthorize,
    withdrawBalance,
    authorizeDelegate,
    revokeDelegate,
    syncAllowanceToBalance,
    depositAndAuthorizeMutation,
    withdrawMutation,
    authorizeMutation,
    revokeMutation,
    syncAllowanceMutation,
  };
}
