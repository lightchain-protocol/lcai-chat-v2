"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { type Address, getContract, parseEther, zeroAddress } from "viem";
import { useAccount } from "wagmi";
import config from "@/config";
import { jobRegistryAbi } from "@/contracts/job-registry-abi";
import { GatewayAuth } from "@/lib/protocol/gateway-auth";
import { GatewayClient } from "@/lib/protocol/gateway-client";
import useWeb3Clients from "./use-web3-clients";

/**
 * Reads + writes the user's prepaid balance and delegate authorization on the
 * JobRegistry contract, and reads the delegate address from the consumer-api
 * (`GET /api/balance`).
 *
 * The on-chain reads use `config.chains[0]` (the protocol chain) — same chain
 * the protocol session targets, regardless of the wallet's selected chain.
 * Write TXs go through the wallet on whatever chain it's on; the dialog should
 * prompt a chain switch if needed (handled by the connect-wallet flow).
 */
export default function usePrepaidBalance() {
  const { publicClient, walletClient } = useWeb3Clients();
  const { address } = useAccount();

  // Protocol always targets the first configured chain.
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

  // Delegate address + authorization come from the consumer-api. We trust the
  // consumer-api to report the delegate it actually submits from; we cross-check
  // authorization on-chain below so a stale/lying API can't trick the UI.
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
      return (await contract.read.balanceOf([address as Address])) as bigint;
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

  const refetchAll = useCallback(() => {
    onChainBalance.refetch();
    delegateAuthorized.refetch();
    apiBalance.refetch();
  }, [onChainBalance, delegateAuthorized, apiBalance]);

  const requireWritable = useCallback(() => {
    if (!contract || !walletClient?.account) {
      throw new Error("Wallet not connected");
    }
    return { contract, account: walletClient.account.address as Address };
  }, [contract, walletClient]);

  /** Top up the prepaid balance. amount is a decimal string of LCAI. */
  const deposit = useCallback(
    async (amount: string | number) => {
      const { account } = requireWritable();
      if (!contract || !walletClient) throw new Error("Wallet not connected");
      const value = parseEther(`${amount}`);
      const { request } = await publicClient.simulateContract({
        address: contract.address,
        abi: jobRegistryAbi,
        functionName: "deposit",
        args: [],
        value,
        account,
      });
      const hash = await walletClient.writeContract(request);
      await publicClient.waitForTransactionReceipt({ hash });
      refetchAll();
      return hash;
    },
    [contract, walletClient, publicClient, requireWritable, refetchAll]
  );

  /** Deposit + authorize the consumer-api delegate in a single TX. */
  const depositAndAuthorize = useCallback(
    async (amount: string | number) => {
      const { account } = requireWritable();
      if (!contract || !walletClient) throw new Error("Wallet not connected");
      if (!delegateAddress) throw new Error("Delegate address not available");
      const value = parseEther(`${amount}`);
      const { request } = await publicClient.simulateContract({
        address: contract.address,
        abi: jobRegistryAbi,
        functionName: "depositAndAuthorize",
        args: [delegateAddress],
        value,
        account,
      });
      const hash = await walletClient.writeContract(request);
      await publicClient.waitForTransactionReceipt({ hash });
      refetchAll();
      return hash;
    },
    [
      contract,
      walletClient,
      publicClient,
      delegateAddress,
      requireWritable,
      refetchAll,
    ]
  );

  /** Pull `amount` LCAI back from the prepaid balance to the wallet. */
  const withdrawBalance = useCallback(
    async (amount: string | number) => {
      const { account } = requireWritable();
      if (!contract || !walletClient) throw new Error("Wallet not connected");
      const wei = parseEther(`${amount}`);
      const { request } = await publicClient.simulateContract({
        address: contract.address,
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
    [contract, walletClient, publicClient, requireWritable, refetchAll]
  );

  const setDelegate = useCallback(
    async (authorized: boolean) => {
      const { account } = requireWritable();
      if (!contract || !walletClient) throw new Error("Wallet not connected");
      if (!delegateAddress) throw new Error("Delegate address not available");
      const { request } = await publicClient.simulateContract({
        address: contract.address,
        abi: jobRegistryAbi,
        functionName: "setDelegateAuthorization",
        args: [delegateAddress, authorized],
        account,
      });
      const hash = await walletClient.writeContract(request);
      await publicClient.waitForTransactionReceipt({ hash });
      refetchAll();
      return hash;
    },
    [
      contract,
      walletClient,
      publicClient,
      delegateAddress,
      requireWritable,
      refetchAll,
    ]
  );

  const authorizeDelegate = useCallback(() => setDelegate(true), [setDelegate]);
  const revokeDelegate = useCallback(() => setDelegate(false), [setDelegate]);

  // Mutations for the dialog UI (handles loading state + toasts at the call site).
  const depositMutation = useMutation({ mutationFn: deposit });
  const depositAndAuthorizeMutation = useMutation({
    mutationFn: depositAndAuthorize,
  });
  const withdrawMutation = useMutation({ mutationFn: withdrawBalance });
  const authorizeMutation = useMutation({ mutationFn: authorizeDelegate });
  const revokeMutation = useMutation({ mutationFn: revokeDelegate });

  const balance = onChainBalance.data ?? 0n;
  const isAuthorized = delegateAuthorized.data ?? false;

  return {
    /** Whether the prepaid feature is usable (contract + delegate known). */
    available: !!contract && !!delegateAddress,
    /** On-chain prepaid balance in wei. */
    balance,
    /** Whether the consumer-api delegate is authorized by the user. */
    isAuthorized,
    /** Delegated submission is ready: balance > 0 and delegate authorized. */
    ready: balance > 0n && isAuthorized,
    delegateAddress,
    isLoading:
      onChainBalance.isLoading ||
      delegateAuthorized.isLoading ||
      apiBalance.isLoading,
    refetch: refetchAll,
    // raw query handles, if a caller needs them
    queries: { onChainBalance, delegateAuthorized, apiBalance },
    // actions
    deposit,
    depositAndAuthorize,
    withdrawBalance,
    authorizeDelegate,
    revokeDelegate,
    // mutation wrappers for UI
    depositMutation,
    depositAndAuthorizeMutation,
    withdrawMutation,
    authorizeMutation,
    revokeMutation,
  };
}
