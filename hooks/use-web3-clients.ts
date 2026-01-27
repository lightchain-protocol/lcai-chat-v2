import { useMemo } from "react";
import { createPublicClient, http } from "viem";
import { useWalletClient } from "wagmi";
import config from "@/config";

export default function useWeb3Clients() {
  const { data: walletClient } = useWalletClient();

  const publicClient = useMemo(
    () =>
      createPublicClient({
        chain: config.chains[0],
        transport: http(),
      }),
    []
  );

  return {
    publicClient,
    walletClient,
  };
}
