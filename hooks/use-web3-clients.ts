import { useMemo } from "react";
import { createPublicClient, http } from "viem";
import { useWalletClient } from "wagmi";
import { lcaiTestnet } from "@/config";

export default function useWeb3Clients() {
  const { data: walletClient } = useWalletClient();

  const publicClient = useMemo(
    () =>
      createPublicClient({
        chain: lcaiTestnet,
        transport: http(),
      }),
    []
  );

  return {
    publicClient,
    walletClient,
  };
}
