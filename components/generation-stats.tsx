"use client";

import { memo } from "react";
import type { GenerationStats } from "@/lib/protocol/relay-client";

/**
 * A compact line under an assistant reply reporting what the model actually
 * did: how many tokens it generated and how fast.
 *
 * Ollama reports these on its terminal object and the worker used to discard
 * them, so until now there was no way for a user to tell a fast reply from a
 * slow one, or to see that a reasoning model spent most of its budget on
 * thinking they never asked for.
 */
function PureGenerationStatsBadge({
  stats,
  worker,
}: {
  stats: GenerationStats;
  worker?: string;
}) {
  const parts: string[] = [];

  if (stats.evalTokens > 0) {
    parts.push(`${stats.evalTokens.toLocaleString()} tokens`);
  }
  if (stats.tokensPerSecond > 0) {
    parts.push(`${stats.tokensPerSecond.toFixed(1)} tok/s`);
  }
  if (stats.thinkingBytes && stats.thinkingBytes > 0) {
    parts.push(`${formatBytes(stats.thinkingBytes)} reasoning`);
  }
  if (worker) {
    parts.push(`served by ${shortenAddress(worker)}`);
  }

  if (parts.length === 0) {
    return null;
  }

  return (
    <div
      className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-content-subtle text-xs"
      data-testid="generation-stats"
    >
      {parts.map((part, i) => (
        <span className="whitespace-nowrap" key={part}>
          {i > 0 && <span className="mr-2 opacity-40">·</span>}
          {part}
        </span>
      ))}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function shortenAddress(address: string): string {
  if (!address.startsWith("0x") || address.length < 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export const GenerationStatsBadge = memo(PureGenerationStatsBadge);
