"use client";

import { useMemo } from "react";
import useSWR from "swr";
import { GatewayClient } from "@/lib/protocol/gateway-client";

export type GatewayModel = { id: string; name: string };

// TEMPORARY — dev-only mock so multiple models can be tested locally before
// enough testnet workers are actually online. Set NEXT_PUBLIC_MOCK_MODELS=true
// in .env.local to enable. Remove this block before opening the real PR.
const MOCK_MODELS: GatewayModel[] = [
  { id: "0xf4a414fa51803433e9197f32cda96d5cb2ac8269c481eb0262fe2dd11f428", name: "llama3-8b" },
  { id: "0x35f686ade96649d2bf47e024eca280619fc80458c5cdece4804fc3f1561bd54", name: "glm-4.7-flash" },
  { id: "0x812058e1dbc4b7ee2b5c8db96cd83bdc110740ae43d3fa4ee116e7e38e2ea80", name: "gpt-oss:20b" },
];

export function useModels() {
  const gateway = useMemo(() => new GatewayClient(), []);
  const { data, error, isLoading } = useSWR(
    "/api/models",
    async () => {
      if (process.env.NEXT_PUBLIC_MOCK_MODELS === "true") {
        return { models: MOCK_MODELS };
      }
      return gateway.getModels();
    },
    { revalidateOnFocus: false, refreshInterval: 20_000 },
  );

  return {
    models: (data?.models ?? []) as GatewayModel[],
    isLoading,
    error,
  };
}