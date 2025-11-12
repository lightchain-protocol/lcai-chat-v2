import { useMemo } from "react";
import { getContract, parseEther } from "viem";
import { type UseQueryReturnType, useQuery } from "wagmi/query";
import config from "@/config";
import { tierDetails } from "@/config/subscription";
import subscriptionAbi from "@/contracts/subscription-abi";
import useCurrentChain from "./use-current-chain";
import useWeb3Clients from "./use-web3-clients";

export default function useSubscription() {
  const chain = useCurrentChain();
  const { publicClient, walletClient } = useWeb3Clients();

  const contract = useMemo(
    () =>
      getContract({
        abi: subscriptionAbi,
        address: config.subscriptionContractAddress[chain.id],
        client: publicClient,
      }),
    [chain.id, publicClient]
  );

  const subscribe = async (
    tier: number,
    yearly: boolean,
    price: number | string
  ) => {
    if (!walletClient) {
      throw new Error("No address found");
    }

    const value = parseEther(`${price}`);
    const balance = await publicClient.getBalance({
      address: walletClient.account.address,
    });

    if (balance < value) {
      throw new Error("Insufficient balance");
    }

    const { request } = await contract.simulate.subscribe(
      [BigInt(tier), BigInt(yearly ? 1 : 0)],
      {
        value,
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
