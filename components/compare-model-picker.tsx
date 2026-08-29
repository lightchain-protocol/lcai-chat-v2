"use client";

import { Check } from "lucide-react";
import { useMemo } from "react";
import { useModels } from "@/hooks/use-models";
import { useWorkerCounts } from "@/hooks/use-worker-counts";
import { type Availability, availabilityOf } from "@/lib/ai/availability";
import { cn } from "@/lib/utils";

export const MIN_COMPARE_MODELS = 2;
export const MAX_COMPARE_MODELS = 4;

const AVAILABILITY_CLASS: Record<Availability, string> = {
  good: "bg-emerald-500",
  shaky: "bg-amber-500",
  unknown: "bg-content-subtle/30",
};

/** Small device-local availability dot, matching the single-model picker. */
export function AvailabilityDot({ modelId }: { modelId: string }) {
  const availability = availabilityOf(modelId);
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block size-1.5 shrink-0 rounded-full",
        AVAILABILITY_CLASS[availability]
      )}
    />
  );
}

/**
 * Multi-select for compare mode: pick between {@link MIN_COMPARE_MODELS} and
 * {@link MAX_COMPARE_MODELS} models to run the same prompt against.
 *
 * Only models a worker is currently serving are selectable — the worker count
 * (WorkerRegistry.getEligibleWorkers, the same data the single-model picker
 * disables on) is reused, and a model showing 0 workers is disabled because it
 * genuinely cannot take a job. Once the cap is reached, unselected rows are
 * disabled so the selection can never exceed the max.
 */
export function CompareModelPicker({
  selectedIds,
  onChange,
  disabled,
}: {
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}) {
  const { models } = useModels();
  const modelIds = useMemo(() => models.map((m) => m.id), [models]);
  const { counts } = useWorkerCounts(modelIds);

  const atCap = selectedIds.length >= MAX_COMPARE_MODELS;

  const toggle = (id: string) => {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((x) => x !== id));
    } else if (!atCap) {
      onChange([...selectedIds, id]);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-medium text-[11px] text-content-strong uppercase tracking-[0.08em]">
          Models to compare
        </span>
        <span className="text-[11px] text-content-subtle">
          {selectedIds.length}/{MAX_COMPARE_MODELS} selected
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {models.length === 0 && (
          <p className="text-content-subtle text-xs">No models available.</p>
        )}
        {models.map((model) => {
          // Undefined count = read failed; treat as available rather than
          // wrongly locking a model out (matches the single-model picker).
          const count = counts[model.id];
          const hasWorker = count === undefined || count > 0;
          const selected = selectedIds.includes(model.id);
          const isDisabled = disabled || !hasWorker || (!selected && atCap);

          return (
            <button
              aria-pressed={selected}
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                selected
                  ? "border-primary/50 bg-primary/10 text-content-strong"
                  : "border-border text-content-secondary hover:bg-surface-base-faint",
                isDisabled &&
                  "cursor-not-allowed opacity-40 hover:bg-transparent"
              )}
              disabled={isDisabled}
              key={model.id}
              onClick={() => toggle(model.id)}
              title={
                hasWorker
                  ? undefined
                  : "No worker is currently serving this model"
              }
              type="button"
            >
              {selected ? (
                <Check
                  className="shrink-0 text-primary"
                  size={12}
                  strokeWidth={3}
                />
              ) : (
                <AvailabilityDot modelId={model.id} />
              )}
              <span className="truncate">{model.name}</span>
              {typeof count === "number" && (
                <span className="font-mono text-[10px] text-content-subtle">
                  {count}w
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
