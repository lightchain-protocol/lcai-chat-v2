"use client";

import { useQuery } from "@tanstack/react-query";
import type { WorkerAvailability } from "@/lib/protocol/gateway-client";
import { GatewayClient } from "@/lib/protocol/gateway-client";

/**
 * Whether the network can take a prompt right now.
 *
 * A full worker does not make a request slow, it makes it fail: `claimSession`
 * refuses the draw, nobody claims, and the session times out after the user has
 * already paid. Polling this lets the composer refuse up front instead.
 *
 * Deliberately unauthenticated and cheap — the gateway caches for one block and
 * shares a single round of chain reads between concurrent callers, so polling
 * from every open tab costs about what one tab costs.
 */
const POLL_INTERVAL_MS = 15_000;

export type UseWorkerAvailability = {
  availability: WorkerAvailability | undefined;
  /** True only when the gateway positively reports every model full. */
  isBusy: boolean;
  /** Spare slots across all models, or null while unknown. */
  freeSlots: number | null;
  /**
   * Whether any worker is registered for these models at all. False means the
   * network has nobody, which waits very differently from everyone being busy.
   */
  hasEligibleWorkers: boolean;
  isLoading: boolean;
};

/**
 * `poll: false` is for a consumer that only needs a rarely-changing answer —
 * whether a model is staffed at all — and can share whatever the query cache
 * already holds. It matters where the hook is called once per rendered row:
 * one poller per message is a lot of gateway traffic for a fact that changes
 * when a worker registers. The composer, which gates sending on a live "is
 * anyone free right now", keeps polling.
 */
export default function useWorkerAvailability(
  modelIds?: string[],
  options?: { poll?: boolean }
): UseWorkerAvailability {
  const key =
    modelIds && modelIds.length > 0 ? [...modelIds].sort().join(",") : "all";
  const poll = options?.poll !== false;

  const { data, isLoading } = useQuery({
    queryKey: ["worker-availability", key],
    queryFn: () => new GatewayClient().getWorkerAvailability(modelIds),
    refetchInterval: poll ? POLL_INTERVAL_MS : false,
    // Keep polling while the user is looking at a blocked composer; that is
    // exactly when they are waiting to be told it has cleared.
    refetchIntervalInBackground: false,
    refetchOnMount: poll,
    refetchOnWindowFocus: true,
    // Focus refetch only fires for stale data; with staleTime equal to the poll
    // interval a returning user always saw the previous poll's answer.
    staleTime: 0,
    retry: false,
  });

  const freeSlots =
    data?.models.length && data.models.every((m) => m.freeSlots !== null)
      ? data.models.reduce((total, m) => total + (m.freeSlots ?? 0), 0)
      : null;

  const hasEligibleWorkers = Boolean(
    data?.models.some((m) => m.eligibleWorkers > 0)
  );

  return {
    availability: data,
    // `unknown` must never block. If our own gateway or its RPC is having a
    // moment, letting people type and hit a real error is better than locking
    // the product on a reading we do not trust.
    isBusy: data?.status === "busy",
    freeSlots,
    hasEligibleWorkers,
    isLoading,
  };
}
