"use client";

import { useQuery } from "@tanstack/react-query";
import config from "@/config";
import { aiConfigAbi } from "@/contracts/ai-config-abi";
import useWeb3Clients from "./use-web3-clients";

/**
 * What sending this message will cost, before it is sent.
 *
 * `AIConfig.calculateJobFee` is the same flat per-model fee the job escrows,
 * so this is the real number rather than an estimate. It is read here because
 * the fee was only ever visible afterwards, in the provenance panel — a
 * product where every message spends real money on a real chain should say so
 * before the money moves, not after.
 *
 * Selecting several models fans the same prompt out to one job each, so the
 * quoted figure is the SUM. Comparing three models costs three fees, and that
 * is exactly the number someone needs before pressing send.
 *
 * The fee is a contract parameter, not live state, so it is cached hard. A
 * failed read returns null and the caller shows nothing: a missing price is
 * better than a wrong one.
 */
export function useJobFee(modelIds: readonly string[]): {
  totalWei: bigint | null;
  perModel: number;
  isLoading: boolean;
} {
  const { publicClient } = useWeb3Clients();
  const chainId = config.chains[0].id;
  const aiConfigAddress = config.aiConfigAddress[chainId];

  // Sorted so [a, b] and [b, a] share one cache entry.
  const ids = [...new Set(modelIds.map((id) => id.toLowerCase()))].sort();

  const query = useQuery({
    queryKey: ["job-fee", chainId, ids],
    enabled:
      ids.length > 0 && Boolean(aiConfigAddress) && aiConfigAddress !== "0x",
    // A flat per-model fee changes only when the contract is reconfigured.
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: 1,
    queryFn: async (): Promise<bigint> => {
      const fees = await Promise.all(
        ids.map((id) =>
          publicClient.readContract({
            address: aiConfigAddress as `0x${string}`,
            abi: aiConfigAbi,
            functionName: "calculateJobFee",
            args: [id as `0x${string}`],
          })
        )
      );
      return (fees as bigint[]).reduce((sum, fee) => sum + fee, 0n);
    },
  });

  return {
    totalWei: query.data ?? null,
    perModel: ids.length,
    isLoading: query.isLoading,
  };
}
