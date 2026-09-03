"use client";

import { useMemo } from "react";
import useSWR from "swr";
import config from "@/config";
import { workerRegistryAbi } from "@/contracts/worker-registry-abi";
import useWeb3Clients from "@/hooks/use-web3-clients";
import { reconcileWorkerCount } from "@/lib/protocol/worker-counts";

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
 *
 * ── Resilience to a flaky RPC ────────────────────────────────────────────────
 * The public RPC (NEXT_PUBLIC_RPC_URL) fronts a pool whose nodes can carry
 * incomplete state, so `getEligibleWorkers` INTERMITTENTLY returns an empty
 * array for a model that genuinely has eligible workers. The flake only ever
 * under-reports (a spurious 0); it never invents workers. Left unguarded that
 * single bad read false-disables every model in the picker.
 *
 * Two layers make the count robust to it, without changing the SWR/dedupe/poll
 * structure:
 *   1. Per fetch, each model is read a few times and the MAX is taken — a
 *      non-zero result from any attempt is authoritative and wins over a
 *      concurrent flaky 0.
 *   2. A session-scoped "last known good" cache remembers the highest count
 *      ever observed for each model (module-level, so it survives re-renders,
 *      remounts and poll cycles). A known-positive count is never downgraded
 *      to 0 by a later flaky read; only a genuinely, repeatedly-0 model — one
 *      no attempt and no prior poll ever saw a worker for — stays at 0 and
 *      disabled. The cache is intentionally session-lived: a page reload
 *      clears it, so a model whose workers truly went away resets on refresh.
 *
 * A read *error* (as opposed to a successful empty read) is still treated as
 * unknown: the model is omitted from that fetch's result rather than counted
 * as 0, exactly as before — but the known-good cache backstops it so an
 * already-seen model does not flicker back to "No workers" on a transient
 * error either.
 */

// Number of on-chain reads per model, per fetch. The max across them defeats
// an intermittent flaky 0 on the very first poll, so the picker shows the real
// count immediately rather than only after a later cycle happens to read clean.
const READS_PER_MODEL = 3;

// Highest worker count ever observed this session, keyed by
// `${chainId}:${registryAddress}:${modelId}`. Module-level on purpose: it is
// the "last known good" store that lets a positive count outlive a single
// flaky 0 across re-renders, remounts and poll cycles within the session.
const lastKnownGood = new Map<string, number>();

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
          const cacheKey = `${chainId}:${registryAddress}:${id}`;

          // A few reads in parallel; the flake is per-read, so taking the max
          // over several attempts recovers the true count even when one (or
          // more) of them lands on a node returning the spurious empty set.
          const attempts = await Promise.allSettled(
            Array.from({ length: READS_PER_MODEL }, () =>
              publicClient.readContract({
                address: registryAddress as `0x${string}`,
                abi: workerRegistryAbi,
                functionName: "getEligibleWorkers",
                args: [id as `0x${string}`],
              })
            )
          );

          const observedLengths = attempts
            .filter((a) => a.status === "fulfilled")
            .map(
              (a) =>
                (a as PromiseFulfilledResult<readonly unknown[]>).value.length
            );

          const cached = lastKnownGood.get(cacheKey);
          const count = reconcileWorkerCount(observedLengths, cached);
          if (count !== undefined && count > 0) {
            lastKnownGood.set(cacheKey, count);
          }
          return [id, count] as const;
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
