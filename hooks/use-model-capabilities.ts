"use client";

import { useMemo } from "react";
import useSWR from "swr";

import { GatewayClient } from "@/lib/protocol/gateway-client";

/**
 * Read-only preflight that fetches the union of heartbeat-advertised
 * capabilities across all currently-active workers eligible for the model
 * (web-search epic, Story 16). The frontend reads this at chat mount to
 * decide whether per-message UI features (e.g. the web-search toggle) are
 * offerable BEFORE a session is bound.
 *
 * `modelId` may be either the friendly local id (e.g. "chat-model") or
 * the hex id; this hook resolves the friendly form via the model registry,
 * then fetches capabilities for the resolved hex. Both fetches are SWR-
 * deduplicated so multiple chat instances on the same model share state.
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

  // Step 1: model registry. Shared SWR key so all chat instances reuse one
  // network call regardless of which model they target.
  const { data: modelsData } = useSWR(
    "/api/models",
    () => gateway.getModels(),
    { revalidateOnFocus: false }
  );

  // Step 2: resolve `modelId` → hex. Mirrors the resolution in
  // use-protocol-session.ts:66-80 (substring match on name, fallback to
  // first model). null when the registry isn't loaded yet.
  const resolvedHex = useMemo(() => {
    if (!modelsData || !modelId) return null;
    if (modelsData.models.length === 0) return null;
    const lowerId = modelId.toLowerCase();
    const match = modelsData.models.find((m) =>
      m.name.toLowerCase().includes(lowerId)
    );
    return match?.id ?? modelsData.models[0].id;
  }, [modelsData, modelId]);

  // Step 3: capabilities, gated on resolvedHex via SWR's null-key
  // disable. The key is the URL path itself so SWR dedupes across hook
  // instances and remembers the result across remounts.
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
