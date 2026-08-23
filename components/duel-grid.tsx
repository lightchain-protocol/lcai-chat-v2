import type { ReactNode } from "react";
import { getChatModel } from "@/lib/ai/models";
import { duelHeading } from "@/lib/protocol/duel";

function modelLabel(modelId: string): string {
  return getChatModel(modelId)?.name ?? modelId;
}

/**
 * Side-by-side duel panes (bc-2 §1). The heading is honest about what the
 * comparison is — duelHeading never labels two runs of the same model as
 * "A vs B". Each pane is a full PreviewMessage, so the per-answer provenance
 * chips (job id, worker, settlement) render independently per side.
 */
export function DuelGrid({
  modelA,
  modelB,
  paneA,
  paneB,
}: {
  modelA: string;
  modelB: string;
  paneA: ReactNode;
  paneB: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-bdr-light bg-surface-base-subtle/40 p-3 md:p-4">
      <p className="mb-3 font-medium text-content-soft text-xs uppercase tracking-wide">
        {duelHeading(modelLabel(modelA), modelLabel(modelB))}
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        <section className="min-w-0">
          <p className="mb-1.5 font-medium text-content-light text-xs">
            {modelLabel(modelA)}
          </p>
          {paneA}
        </section>
        <section className="min-w-0">
          <p className="mb-1.5 font-medium text-content-light text-xs">
            {modelLabel(modelB)}
          </p>
          {paneB}
        </section>
      </div>
    </div>
  );
}
