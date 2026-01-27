import { useMemo } from "react";
import { toast } from "sonner";
import { erc20Abi, formatEther, getContract, parseEther } from "viem";
import { useAccount } from "wagmi";
import { type UseQueryReturnType, useQuery } from "wagmi/query";
import config from "@/config";
import { tierDetails } from "@/config/subscription";
import subscriptionAbi from "@/contracts/subscription-abi";
import useCurrentChain from "./use-current-chain";
import useWeb3Clients from "./use-web3-clients";

export default function useSubscription() {
  const chain = useCurrentChain();
  const { publicClient, walletClient } = useWeb3Clients();
  const { address } = useAccount();

  const lcaiTokenContract = useMemo(
    () =>
      getContract({
        address: config.lcaiToken[chain.id].address,
        abi: erc20Abi,
        client: {
          public: publicClient,
          wallet: walletClient,
        },
      }),
    [chain.id, publicClient, walletClient]
  );

  const lcaiBalance: UseQueryReturnType<bigint, Error> = useQuery({
    queryKey: ["lcaiBalance", address],
    queryFn: () => lcaiTokenContract.read.balanceOf([address as `0x${string}`]),
    enabled: !!address && !!lcaiTokenContract,
  });

  const contract = useMemo(
    () =>
      getContract({
        abi: subscriptionAbi,
        address: config.subscriptionContractAddress[chain.id],
        client: publicClient,
      }),
    [chain.id, publicClient]
  );

  const checkAllowance = async (
    owner: `0x${string}`,
    spender: `0x${string}`,
    amount: bigint
  ) => {
    if (!lcaiTokenContract || !walletClient || !owner) return;

    const allowance = await lcaiTokenContract.read.allowance([owner, spender]);

    if (allowance < amount) {
      // Approve only the exact amount needed for this transaction
      const { request } = await lcaiTokenContract.simulate.approve(
        [spender, amount],
        {
          account: walletClient.account.address,
        }
      );
      const hash = await walletClient.writeContract(request);
      await publicClient.waitForTransactionReceipt({ hash });
      toast.success("Token spend approved successfully");
    }
  };

  const subscribe = async (
    tier: number,
    yearly: boolean,
    price: number | string
  ) => {
    if (!walletClient) {
      throw new Error("No address found");
    }

    const priceInWei = parseEther(`${price}`);

    if (+formatEther(lcaiBalance.data || 0n) < +price) {
      throw new Error("Insufficient balance");
    }

    await checkAllowance(
      address as `0x${string}`,
      config.subscriptionContractAddress[chain.id],
      priceInWei
    );

    const { request } = await contract.simulate.subscribe(
      [BigInt(tier), BigInt(yearly ? 1 : 0)],
      {
        account: walletClient.account.address,
      }
    );

    const hash = await walletClient.writeContract(request);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    hasActiveSubscription.refetch();

    return receipt;
  };

  const hasActiveSubscription: UseQueryReturnType<boolean, Error> = useQuery({
    queryKey: ["hasActiveSubscription", walletClient?.account.address],
    queryFn: () =>
      // biome-ignore lint: Forbidden non-null assertion.
      contract.read.hasActiveSubscription([walletClient!.account.address]),
    enabled: !!walletClient,
  });

  const activeSubscription = useQuery({
    queryKey: ["activeSubscription", walletClient?.account.address],
    queryFn: () =>
      // biome-ignore lint: Forbidden non-null assertion.
      contract.read.getSubscription([walletClient!.account.address]),
    enabled: !!walletClient,
    select: (data) => {
      const tierId = Number(data[0]);
      const tier = tierDetails[tierId]?.name || tierId;
      return {
        // sub.tier, sub.expiryTimestamp, expired
        tier,
        expiryTimestamp: Number(data[1]),
        expired: Boolean(data[2]),
      };
    },
  });

  return {
    contract,
    subscribe,
    hasActiveSubscription,
    activeSubscription,
  };
}
