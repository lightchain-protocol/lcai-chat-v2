"use client";

import { useMemo } from "react";
import useSWR from "swr";
import { workerRegistryAbi } from "@/contracts/worker-registry-abi";
import config from "@/config";
import useWeb3Clients from "@/hooks/use-web3-clients";

/**
 * Per-model live worker count, read on-chain from the WorkerRegistry.
 *
 * The picker uses this to show how many workers are eligible for each model
 * and to disable models that no worker is currently serving. The count is the
 * length of `getEligibleWorkers(bytes32 modelId)` — the same eligibility set
 * the dispatcher claims from, so a model showing "0 workers" genuinely cannot
 * take a job right now.
 *
 * modelIds are the real bytes32 hex ids from useModels(). Counts are fetched
 * in one batch (Promise.all) and shared through SWR: the key is derived from
 * the sorted id set + registry address, so every mounted picker dedupes into
 * a single round of reads and the result is cached across re-renders and
 * remounts rather than refetched each render.
 */
export function useWorkerCounts(modelIds: string[]): {
  counts: Record<string, number>;
  isLoading: boolean;
  error: unknown;
} {
  const { publicClient } = useWeb3Clients();

  // Protocol always targets the first configured chain, matching how the
  // session/transport resolve the registry address.
  const chainId = config.chains[0].id;
  const registryAddress = config.workerRegistryAddress[chainId];

  // Stable, order-independent key so [a,b] and [b,a] dedupe to one fetch and
  // identity churn in the caller's array doesn't retrigger the read.
  const sortedIds = useMemo(
    () => [...new Set(modelIds)].sort(),
    [modelIds]
  );

  const enabled =
    sortedIds.length > 0 &&
    !!registryAddress &&
    registryAddress !== "0x" &&
    !!publicClient;

  const swrKey = enabled
    ? `worker-counts:${chainId}:${registryAddress}:${sortedIds.join(",")}`
    : null;

  const { data, error, isLoading } = useSWR(
    swrKey,
    async () => {
      const entries = await Promise.all(
        sortedIds.map(async (id) => {
          try {
            const workers = (await publicClient.readContract({
              address: registryAddress as `0x${string}`,
              abi: workerRegistryAbi,
              functionName: "getEligibleWorkers",
              args: [id as `0x${string}`],
            })) as readonly string[];
            return [id, workers.length] as const;
          } catch {
            // A per-model read failure must not blank the whole picker or
            // wrongly disable a model — treat it as unknown by omitting it.
            return [id, undefined] as const;
          }
        })
      );
      const result: Record<string, number> = {};
      for (const [id, count] of entries) {
        if (typeof count === "number") {
          result[id] = count;
        }
      }
      return result;
    },
    {
      revalidateOnFocus: false,
      // Worker sets shift as nodes come online/offline; a slow poll keeps the
      // count roughly current without hammering the RPC.
      refreshInterval: 30_000,
    }
  );

  return {
    counts: data ?? {},
    isLoading,
    error,
  };
}
