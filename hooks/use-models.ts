"use client";

import { useMemo } from "react";
import useSWR from "swr";
import { GatewayClient } from "@/lib/protocol/gateway-client";

export type GatewayModel = { id: string; name: string };

/**
 * Live, worker-availability-aware model list from the gateway.
 * Shared SWR key ("/api/models") so every consumer — the picker, the
 * capabilities preflight, session resolution — dedupes into one fetch
 * instead of each hook instance re-fetching independently.
 *
 * A model only appears here if it currently has at least one active
 * worker — confirmed by observation: llama3-70b is whitelisted on-chain
 * (AIConfig/WorkerRegistry) but absent from this response while it has
 * zero workers running it. Newly-whitelisted models will appear here
 * automatically as soon as a worker comes online for them, with no
 * frontend change needed.
 */
export function useModels() {
  const gateway = useMemo(() => new GatewayClient(), []);
  const { data, error, isLoading } = useSWR(
    "/api/models",
    () => gateway.getModels(),
    { revalidateOnFocus: false, refreshInterval: 20_000 },
  );

  return {
    models: (data?.models ?? []) as GatewayModel[],
    isLoading,
    error,
  };
}