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
import { ModelLogo } from "./model-logo";

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
 * The main composer's model picker: a compact multi-select for 1–4 models
 * ({@link min}..{@link MAX_COMPARE_MODELS}). One selected model is the ordinary
 * single-model chat; two or more fan the same prompt out to a column each.
 *
 * A dropdown so it lives *inside* the composer's toolbar. The trigger adapts —
 * one selected model shows its logo + name (reading like the old single-model
 * picker), several read as "N models"; opening it reveals the checkable list.
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
  min = MIN_COMPARE_MODELS,
}: {
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  /**
   * Fewest models the selection may hold — deselecting the last one below this
   * is refused so the composer always has at least one model to send to. The
   * main chat passes 1 (the picker doubles as the single-model selector);
   * compare kept the default of 2.
   */
  min?: number;
}) {
  const { models } = useModels();
  const modelIds = useMemo(() => models.map((m) => m.id), [models]);
  const { counts } = useWorkerCounts(modelIds);

  const atCap = selectedIds.length >= MAX_COMPARE_MODELS;

  const toggle = (id: string) => {
    if (selectedIds.includes(id)) {
      // Never drop below the floor — the last kept model can't be removed.
      if (selectedIds.length <= min) return;
      onChange(selectedIds.filter((x) => x !== id));
    } else if (!atCap) {
      onChange([...selectedIds, id]);
    }
  };

  const count = selectedIds.length;
  const soleModel =
    count === 1 ? models.find((m) => m.id === selectedIds[0]) : undefined;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button
          className="flex h-8 items-center gap-2 rounded-xl border-0 px-1.5 text-content-default shadow-none transition-colors hover:bg-surface-base-faint focus:outline-none focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50 data-[state=open]:bg-surface-base-faint"
          type="button"
        >
          {count === 1 ? (
            <>
              {soleModel && <AvailabilityDot modelId={soleModel.id} />}
              {soleModel && <ModelLogo modelId={soleModel.id} size={14} />}
              <span className="hidden font-medium text-xs sm:block">
                {soleModel?.name ?? "1 model"}
              </span>
            </>
          ) : (
            <>
              <Layers className="size-4 text-primary" />
              <span className="font-medium text-xs">
                {count === 0 ? "Select models" : `${count} models`}
              </span>
            </>
          )}
          <ChevronDown className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="min-w-[240px] max-w-[300px]"
      >
        <div className="flex items-baseline justify-between gap-2 px-2 py-1">
          <span className="font-medium text-[11px] text-content-strong uppercase tracking-[0.08em]">
            Models
          </span>
          <span className="text-[11px] text-content-subtle">
            {count}/{MAX_COMPARE_MODELS} · pick up to {MAX_COMPARE_MODELS}
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
                  <ModelLogo modelId={model.id} size={14} />
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
