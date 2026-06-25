"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { type Address, getContract, parseEther } from "viem";
import { useAccount } from "wagmi";
import config from "@/config";
import { jobRegistryAbi } from "@/contracts/job-registry-abi";
import { GatewayAuth } from "@/lib/protocol/gateway-auth";
import { GatewayClient } from "@/lib/protocol/gateway-client";
import useWeb3Clients from "./use-web3-clients";

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

  const apiBalance = useQuery({
    queryKey: ["prepaid-api-balance", address?.toLowerCase()],
    enabled: !!address,
    queryFn: () => new GatewayClient(undefined, new GatewayAuth()).getBalance(),
    staleTime: 30_000,
  });

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
    [
      requireWritable,
      walletClient,
      publicClient,
      delegateAddress,
      refetchAll,
    ]
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

  return {
    available: !!contract && !!delegateAddress,
    balance,
    allowance,
    isAuthorized,
    needsAllowanceSync,
    /** Gas-free prompts: funded, authorized, and delegate has spending headroom. */
    ready: balance > 0n && isAuthorized && allowance > 0n,
    delegateAddress,
    isLoading:
      onChainBalance.isLoading ||
      delegateAuthorized.isLoading ||
      delegateAllowanceQuery.isLoading ||
      apiBalance.isLoading,
    refetch: refetchAll,
    queries: { onChainBalance, delegateAuthorized, delegateAllowanceQuery, apiBalance },
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
