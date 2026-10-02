"use client";

import { useMemo } from "react";
import useSWR from "swr";

import { useModels } from "@/hooks/use-models";
import { GatewayClient } from "@/lib/protocol/gateway-client";

/**
 * Read-only preflight that fetches the union of heartbeat-advertised
 * capabilities across all currently-active workers eligible for the model
 * (web-search epic, Story 16). The frontend reads this at chat mount to
 * decide whether per-message UI features (e.g. the web-search toggle) are
 * offerable BEFORE a session is bound.
 *
 * `modelId` is now always the real hex id from the model picker (which reads
 * directly from useModels()) — no more friendly-name fuzzy resolution needed.
 * We still validate it against the live model list before fetching
 * capabilities, so a stale/unavailable modelId doesn't trigger a request.
 *
 * Returns `availableCapabilities: []` until the data resolves — chat.tsx
 * relies on the empty default to render the toggle in its "preflight not
 * yet known" state without nil guards.
 */
export function useModelCapabilities(modelId: string | undefined) {
  // Single GatewayClient instance per hook instance; no auth provider
  // because both /api/models and /api/models/:id/capabilities are
  // unauthenticated public metadata.
  const gateway = useMemo(() => new GatewayClient(), []);

  // Shared model list — same SWR key as the picker and use-protocol-session,
  // so this dedupes into one network call regardless of how many components
  // are mounted.
  const { models } = useModels();

  // modelId is a real hex id now; just confirm it's one of the currently
  // live/available models before fetching capabilities for it.
  const resolvedHex = useMemo(() => {
    if (!modelId || models.length === 0) return null;
    return models.some((m) => m.id === modelId) ? modelId : null;
  }, [modelId, models]);

  // Capabilities, gated on resolvedHex via SWR's null-key disable. The key
  // is the URL path itself so SWR dedupes across hook instances and
  // remembers the result across remounts.
  const { data: capabilitiesData, error } = useSWR(
    resolvedHex ? `/api/models/${resolvedHex}/capabilities` : null,
    () => gateway.getModelCapabilities(resolvedHex as string),
    { revalidateOnFocus: false }
  );

  return {
    availableCapabilities: capabilitiesData?.capabilities ?? [],
    error,
    isReady: !!capabilitiesData,
  };
}