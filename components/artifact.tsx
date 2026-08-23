"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import {
  GENUI_RENDERER_ENABLED,
  isGenuiDescriptor,
  validateGenuiTree,
} from "@/lib/ai/genui";
import type { ArtifactDescriptor } from "@/lib/protocol/audio-stream";
import { cn } from "@/lib/utils";
import { Response } from "./elements/response";
import { GenuiRenderer } from "./genui-renderer";

/**
 * Renderer for `artifact`-kind frames (lightchain.genui/tool-trace wire
 * contract, worker artifact.go).
 *
 * Honesty boundary (bc-2-nontext-settlement.md §5): artifacts are DELIVERED,
 * NOT SETTLED — no on-chain commitment covers them until the Phase-2
 * manifestHash ships. The badge on every card says exactly that, and no
 * renderer here may imply provenance. The wire contract also tells consumers
 * to refuse schemas they do not recognize rather than guess at the payload,
 * so unknown (artifactType, schema) pairs fall back to a collapsed raw-JSON
 * view.
 *
 * No producers exist yet (Phase-2 job classes); these renderers cover the
 * safe starter set.
 */

/** Suggested copy from bc-2-nontext-settlement.md §5 — keep verbatim. */
export const DELIVERED_NOT_SETTLED_LABEL =
  "Delivered · settles on-chain in an upcoming release";

type CodePayload = { language?: string; code: string };
type MarkdownPayload = { markdown: string };
type KeyValuePayload = { entries: Array<{ key: string; value: string }> };

function asCodePayload(payload: unknown): CodePayload | null {
  if (
    payload &&
    typeof payload === "object" &&
    typeof (payload as CodePayload).code === "string"
  ) {
    const p = payload as CodePayload;
    return {
      code: p.code,
      language: typeof p.language === "string" ? p.language : undefined,
    };
  }
  return null;
}

function asMarkdownPayload(payload: unknown): MarkdownPayload | null {
  if (
    payload &&
    typeof payload === "object" &&
    typeof (payload as MarkdownPayload).markdown === "string"
  ) {
    return payload as MarkdownPayload;
  }
  return null;
}

function asKeyValuePayload(payload: unknown): KeyValuePayload | null {
  if (!payload || typeof payload !== "object") return null;
  const entries = (payload as KeyValuePayload).entries;
  if (!Array.isArray(entries)) return null;
  if (
    !entries.every(
      (e) =>
        e &&
        typeof e === "object" &&
        typeof (e as { key: unknown }).key === "string" &&
        typeof (e as { value: unknown }).value === "string"
    )
  ) {
    return null;
  }
  return payload as KeyValuePayload;
}

function CodeCard({ payload }: { payload: CodePayload }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative">
      <button
        className="absolute top-2 right-2 rounded-md border border-bdr-light bg-surface-base-faint p-1.5 text-content-secondary transition-colors hover:bg-surface-base-light"
        onClick={() => {
          navigator.clipboard
            .writeText(payload.code)
            .then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            })
            .catch(() => {
              /* best-effort */
            });
        }}
        title="Copy code"
        type="button"
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
      </button>
      {payload.language && (
        <span className="absolute top-2 left-3 font-mono text-[10px] text-content-subtle uppercase">
          {payload.language}
        </span>
      )}
      <pre className="overflow-x-auto rounded-lg bg-surface-base-faint p-3 pt-7 font-mono text-content-default text-xs">
        <code>{payload.code}</code>
      </pre>
    </div>
  );
}

function KeyValueCard({ payload }: { payload: KeyValuePayload }) {
  return (
    <table className="w-full text-xs">
      <tbody>
        {payload.entries.map((entry) => (
          <tr
            className="border-bdr-light border-b last:border-0"
            key={entry.key}
          >
            <td className="py-1.5 pr-3 font-medium text-content-secondary">
              {entry.key}
            </td>
            <td className="py-1.5 font-mono text-content-default">
              {entry.value}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ArtifactBody({ descriptor }: { descriptor: ArtifactDescriptor }) {
  const { artifactType, schema, payload } = descriptor;

  if (artifactType === "code" && schema === "lightchain.code.v1") {
    const code = asCodePayload(payload);
    if (code) return <CodeCard payload={code} />;
  }

  if (artifactType === "markdown" && schema === "lightchain.markdown.v1") {
    const md = asMarkdownPayload(payload);
    if (md) return <Response>{md.markdown}</Response>;
  }

  if (artifactType === "key_value" && schema === "lightchain.keyvalue.v1") {
    const kv = asKeyValuePayload(payload);
    if (kv) return <KeyValueCard payload={kv} />;
  }

  // Generative UI (lightchain.genui.v1): validate → render, or fall back per
  // the contract's policy. The flag gates only the display path — no frames
  // exist until the worker-side envelope opt-in ships.
  if (GENUI_RENDERER_ENABLED && isGenuiDescriptor(descriptor)) {
    const tree = validateGenuiTree(payload);
    if (tree) {
      return <GenuiRenderer node={tree} />;
    }
    return (
      <details className="text-xs" open>
        <summary className="cursor-pointer text-content-secondary">
          Invalid lightchain.genui.v1 payload — showing raw
        </summary>
        <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-surface-base-faint p-3 font-mono text-content-subtle">
          {JSON.stringify(payload, null, 2)}
        </pre>
      </details>
    );
  }

  // Unknown or shape-mismatched payloads are shown raw, not interpreted —
  // the wire contract is to refuse schemas we do not recognize.
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-content-secondary">
        Raw artifact payload
      </summary>
      <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-surface-base-faint p-3 font-mono text-content-subtle">
        {JSON.stringify(payload, null, 2)}
      </pre>
    </details>
  );
}

export function ArtifactCard({
  descriptor,
  className,
}: {
  descriptor: ArtifactDescriptor;
  className?: string;
}) {
  return (
    <div
      className={cn("rounded-xl border border-bdr-light p-3", className)}
      data-testid="artifact-card"
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="font-mono text-[10px] text-content-subtle">
          {descriptor.artifactType} · {descriptor.schema}
        </span>
        <span
          className="ml-auto rounded bg-muted px-1.5 py-0.5 text-[10px] text-content-secondary"
          title="Artifact frames carry no on-chain commitment yet — see the settlement timeline for what is settled"
        >
          {DELIVERED_NOT_SETTLED_LABEL}
        </span>
      </div>
      <ArtifactBody descriptor={descriptor} />
    </div>
  );
}
