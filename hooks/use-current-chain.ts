import { useMemo } from "react";
import { useChainId } from "wagmi";
import config from "@/config";

export default function useCurrentChain() {
  const chainId = useChainId();
  return useMemo(
    () =>
      config.chains.find((chain) => chain.id === chainId) || config.chains[0],
    [chainId]
  );
}
