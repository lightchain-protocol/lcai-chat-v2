"use client";

import { ChevronDown, Layers } from "lucide-react";
import { useMemo } from "react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
 * Compact multi-select for compare mode: pick between {@link MIN_COMPARE_MODELS}
 * and {@link MAX_COMPARE_MODELS} models to run the same prompt against.
 *
 * A dropdown so it can live *inside* the composer's toolbar — the same slot the
 * single-model picker sits in on the normal chat — instead of a separate card.
 * The trigger reads as one restrained toolbar control ("N models"); opening it
 * reveals the checkable list.
 *
 * Only models a worker is currently serving are selectable — the worker count
 * (WorkerRegistry.getEligibleWorkers, the same data the single-model picker
 * disables on) is reused, and a model showing 0 workers is disabled because it
 * genuinely cannot take a job. Once the cap is reached, unselected rows are
 * disabled so the selection can never exceed the max. Selecting a row keeps the
 * menu open (preventDefault) so several models can be toggled in one pass.
 */
export function CompareModelMultiSelect({
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

  const count = selectedIds.length;
  const label =
    count === 0 ? "Select models" : `${count} model${count === 1 ? "" : "s"}`;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button
          className="flex h-8 items-center gap-2 rounded-xl border-0 px-1.5 text-content-default shadow-none transition-colors hover:bg-surface-base-faint focus:outline-none focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50 data-[state=open]:bg-surface-base-faint"
          type="button"
        >
          <Layers className="size-4 text-primary" />
          <span className="font-medium text-xs">{label}</span>
          <ChevronDown className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="min-w-[240px] max-w-[300px]"
      >
        <div className="flex items-baseline justify-between gap-2 px-2 py-1">
          <span className="font-medium text-[11px] text-content-strong uppercase tracking-[0.08em]">
            Compare
          </span>
          <span className="text-[11px] text-content-subtle">
            {count}/{MAX_COMPARE_MODELS} selected
          </span>
        </div>
        {models.length === 0 && (
          <p className="px-2 py-3 text-center text-content-subtle text-xs">
            No models available.
          </p>
        )}
        {models.map((model) => {
          // Undefined count = read failed; treat as available rather than
          // wrongly locking a model out (matches the single-model picker).
          const workerCount = counts[model.id];
          const hasWorker = workerCount === undefined || workerCount > 0;
          const selected = selectedIds.includes(model.id);
          const isDisabled = disabled || !hasWorker || (!selected && atCap);

          return (
            <DropdownMenuCheckboxItem
              checked={selected}
              className="rounded-lg"
              disabled={isDisabled}
              key={model.id}
              onSelect={(event) => {
                event.preventDefault();
                toggle(model.id);
              }}
            >
              <span className="flex w-full min-w-0 items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5">
                  <AvailabilityDot modelId={model.id} />
                  <span className="truncate font-medium text-xs">
                    {model.name}
                  </span>
                </span>
                {typeof workerCount === "number" && (
                  <span
                    className={cn(
                      "ml-auto shrink-0 font-mono text-[10px]",
                      workerCount === 0 ? "text-red-500" : "text-content-subtle"
                    )}
                  >
                    {workerCount}w
                  </span>
                )}
              </span>
            </DropdownMenuCheckboxItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
