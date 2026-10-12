"use client";

import { useMemo } from "react";
import useSWR from "swr";
import { ttsModelId } from "@/config";
import { GatewayClient } from "@/lib/protocol/gateway-client";
import { withoutModel } from "@/lib/protocol/resolve-model";

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

/**
 * The models a chat message can be sent to: the list above without the speech
 * model behind read-aloud. The picker and the chat's default selection read
 * this one; anything that only names a model keeps reading useModels().
 */
export function useChatModels() {
  const { models, isLoading, error } = useModels();
  const chatModels = useMemo(() => withoutModel(models, ttsModelId), [models]);

  return { models: chatModels, isLoading, error };
}
