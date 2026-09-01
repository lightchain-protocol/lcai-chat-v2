"use client";

import {
  SiAlibabacloud,
  SiGoogle,
  SiMeta,
} from "@icons-pack/react-simple-icons";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Real provider logos shown next to each model. These are third-party
 * trademarks (Meta, Microsoft, Google, Alibaba) used nominatively to identify
 * the model that produced an answer — not as endorsement. simple-icons ships no
 * Microsoft or Qwen mark in this version, so Phi uses the Microsoft four-square
 * logo drawn inline, and Qwen borrows its maker's Alibaba Cloud mark.
 */

function MicrosoftMark({
  size = 16,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      height={size}
      role="img"
      viewBox="0 0 24 24"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect fill="#F25022" height="10.5" width="10.5" x="1" y="1" />
      <rect fill="#7FBA00" height="10.5" width="10.5" x="12.5" y="1" />
      <rect fill="#00A4EF" height="10.5" width="10.5" x="1" y="12.5" />
      <rect fill="#FFB900" height="10.5" width="10.5" x="12.5" y="12.5" />
    </svg>
  );
}

type Brand = {
  /** Human-readable maker, used for the logo's accessible title. */
  provider: string;
  render: (size: number) => ReactNode;
};

/** Maps a model id (by family prefix) to its maker's logo, or null if unknown. */
function brandFor(modelId: string): Brand | null {
  const id = modelId.toLowerCase();
  if (id.startsWith("llama")) {
    return {
      provider: "Meta",
      render: (size) => <SiMeta color="#0467DF" size={size} title="Meta" />,
    };
  }
  if (id.startsWith("phi")) {
    return {
      provider: "Microsoft",
      render: (size) => <MicrosoftMark size={size} />,
    };
  }
  if (id.startsWith("qwen")) {
    return {
      provider: "Alibaba",
      render: (size) => (
        <SiAlibabacloud color="#FF6A00" size={size} title="Qwen · Alibaba" />
      ),
    };
  }
  if (id.startsWith("gemma")) {
    return {
      provider: "Google",
      render: (size) => <SiGoogle color="#4285F4" size={size} title="Google" />,
    };
  }
  return null;
}

/** True when we have a real logo for this model (else callers keep text only). */
export function hasModelLogo(modelId: string): boolean {
  return brandFor(modelId) !== null;
}

/** Small provider logo for a model; renders nothing for unmapped models. */
export function ModelLogo({
  modelId,
  size = 16,
  className,
}: {
  modelId: string;
  size?: number;
  className?: string;
}) {
  const brand = brandFor(modelId);
  if (!brand) {
    return null;
  }
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center",
        className
      )}
    >
      {brand.render(size)}
    </span>
  );
}
