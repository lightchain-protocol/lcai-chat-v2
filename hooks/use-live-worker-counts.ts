"use client";

import { useMemo } from "react";
import type { WorkerAvailabilityStatus } from "@/lib/protocol/gateway-client";
import useWorkerAvailability from "./use-worker-availability";

/**
 * Per-model liveness, sourced from the consumer-api availability endpoint —
 * which intersects on-chain eligibility (`getEligibleWorkers`) with the gateway
 * heartbeat store, so a registered-but-dead box is NOT counted.
 *
 * This replaces reading `getEligibleWorkers` straight from the browser: that
 * raw on-chain set lists every worker ever registered for a model, dead GPU box
 * included, which is exactly how the picker used to offer a model that then
 * 500s / times out on init. The endpoint's count only ever reflects workers
 * currently heartbeating.
 */
export type ModelLiveness = {
  /**
   * Live worker count. `undefined` means "unknown" (the server could not read
   * the chain/heartbeats) — callers must treat unknown as available and NOT
   * disable the model, matching the old fail-open behaviour.
   */
  count: number | undefined;
  /** Spare job slots across live workers; null when unknown. */
  freeSlots: number | null;
  status: WorkerAvailabilityStatus | undefined;
};

export function useLiveWorkerCounts(modelIds: string[]): {
  byModel: Record<string, ModelLiveness>;
  /**
   * Convenience view: `{ modelId(lowercased) -> live count }`, only for models
   * whose count is known. Drop-in for callers that ranked models by the old
   * on-chain worker count (e.g. "default to the most-staffed model").
   */
  counts: Record<string, number>;
  isLoading: boolean;
} {
  const { availability, isLoading } = useWorkerAvailability(modelIds);

  const byModel = useMemo(() => {
    const map: Record<string, ModelLiveness> = {};
    for (const m of availability?.models ?? []) {
      map[m.modelId.toLowerCase()] = {
        // A per-model "unknown" is a failed read, not a real zero — leave the
        // count undefined so the picker stays open rather than false-disabling.
        count: m.status === "unknown" ? undefined : m.eligibleWorkers,
        freeSlots: m.freeSlots,
        status: m.status,
      };
    }
    return map;
  }, [availability]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const [id, l] of Object.entries(byModel)) {
      if (l.count !== undefined) c[id] = l.count;
    }
    return c;
  }, [byModel]);

  return { byModel, counts, isLoading };
}
