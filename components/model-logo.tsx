"use client";

import {
  SiAlibabacloud,
  SiGoogle,
  SiMeta,
} from "@icons-pack/react-simple-icons";
import type { ReactNode } from "react";
import { useModels } from "@/hooks/use-models";
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

/**
 * Maps a model FAMILY (by friendly-name prefix — "llama3-8b", "phi3-mini",
 * "qwen2.5-3b", "gemma2-2b") to its maker's logo, or null if unknown.
 *
 * NB: this must be given the friendly NAME, never the bytes32 hex id every
 * picker/column passes around — a `0x…` string matches no prefix and the logo
 * silently disappears. {@link ModelLogo} resolves hex → name before calling
 * this; the fix for that bug lives there.
 */
function brandFor(modelName: string): Brand | null {
  const id = modelName.toLowerCase();
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

/** A bytes32 model id looks like `0x` + 64 hex chars; friendly names never do. */
const HEX_ID = /^0x[0-9a-f]+$/i;

/**
 * Small provider logo for a model; renders nothing for unmapped models.
 *
 * Accepts EITHER the friendly name ("llama3-8b") or the bytes32 hex id every
 * call site actually passes (`model.id`, `pane.modelId`). A hex id is resolved
 * to its friendly name via the live model list before matching — without this
 * `brandFor` never matched a `0x…` string and no logo ever rendered.
 */
export function ModelLogo({
  modelId,
  size = 16,
  className,
}: {
  /** Friendly name or bytes32 hex id — either resolves to the same logo. */
  modelId: string;
  size?: number;
  className?: string;
}) {
  const { models } = useModels();
  const name = HEX_ID.test(modelId)
    ? (models.find((m) => m.id === modelId)?.name ?? modelId)
    : modelId;
  const brand = brandFor(name);
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
