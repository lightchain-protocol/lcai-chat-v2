"use client";

import { ChevronDown } from "lucide-react";
import { useMemo } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  type ModelLiveness,
  useLiveWorkerCounts,
} from "@/hooks/use-live-worker-counts";
import { useModels } from "@/hooks/use-models";
import { formatThroughput, typicalThroughput } from "@/lib/model-throughput";
import { cn } from "@/lib/utils";
import { ModelLogo } from "./model-logo";

/**
 * Fleet availability dot, driven by the liveness-aware availability endpoint
 * (heartbeat-intersected), not a device-local guess:
 *   green  — live workers with spare capacity, ready now
 *   amber  — live workers but all busy (a request would queue/refuse)
 *   red    — nobody heartbeating for this model right now
 *   grey   — unknown (read failed); never used to block
 */
function dotClass(liveness?: ModelLiveness): string {
  if (!liveness || liveness.count === undefined) {
    return "bg-content-subtle/30";
  }
  if (liveness.count === 0) {
    return "bg-red-500";
  }
  if (liveness.freeSlots !== null && liveness.freeSlots <= 0) {
    return "bg-amber-500";
  }
  return "bg-emerald-500";
}

/**
 * Appends the speed this model has actually delivered on this device, once
 * enough answers have been seen to say.
 *
 * Measured rather than published: the same model runs an order of magnitude
 * apart on different workers, so a catalogue figure would be wrong for
 * whoever draws the other one. Silent until there is evidence — a guess about
 * speed is worse than none, because it is what someone decides against before
 * paying a fee.
 */
function speedHint(modelId: string): string {
  const typical = typicalThroughput(modelId);
  return typical === null ? "" : ` · ${formatThroughput(typical)}`;
}

export function AvailabilityDot({ liveness }: { liveness?: ModelLiveness }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block size-1.5 shrink-0 rounded-full",
        dotClass(liveness)
      )}
    />
  );
}

/**
 * The composer's model picker: a dropdown that always holds exactly one model.
 * Picking a row replaces the current model and closes the menu.
 *
 * Every model stays selectable. The live count from the availability endpoint
 * only labels a row ("Offline" / "Busy" / "N online"); it never disables one.
 * Liveness is derived from on-chain claim activity, so refusing the request
 * that would let a worker claim and prove itself alive starves the signal and
 * leaves the model "offline" for good.
 */
export function ModelSelect({
  selectedId,
  onChange,
  disabled,
}: {
  selectedId: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  const { models } = useModels();
  const modelIds = useMemo(() => models.map((m) => m.id), [models]);
  const { byModel } = useLiveWorkerCounts(modelIds);

  const selected = models.find((m) => m.id === selectedId);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button
          className="flex h-8 items-center gap-2 rounded-xl border-0 px-1.5 text-content-default shadow-none transition-colors hover:bg-surface-base-faint focus:outline-none focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50 data-[state=open]:bg-surface-base-faint"
          type="button"
        >
          {selected && (
            <AvailabilityDot liveness={byModel[selected.id.toLowerCase()]} />
          )}
          {selected && <ModelLogo modelId={selected.id} size={14} />}
          <span className="hidden font-medium text-xs sm:block">
            {selected?.name ?? "Select model"}
          </span>
          <ChevronDown className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="min-w-[240px] max-w-[300px]"
      >
        <div className="px-2 py-1">
          <span className="font-medium text-[11px] text-content-strong uppercase tracking-[0.08em]">
            Models
          </span>
        </div>
        {models.length === 0 && (
          <p className="px-2 py-3 text-center text-content-subtle text-xs">
            No models available.
          </p>
        )}
        <DropdownMenuRadioGroup onValueChange={onChange} value={selectedId}>
          {models.map((model) => {
            // Liveness-aware count from the availability endpoint: a label,
            // never a gate (see the component comment). Undefined = unknown.
            const liveness = byModel[model.id.toLowerCase()];
            const workerCount = liveness?.count;
            const allBusy =
              typeof workerCount === "number" &&
              workerCount > 0 &&
              liveness?.freeSlots !== null &&
              (liveness?.freeSlots ?? 0) <= 0;

            return (
              <DropdownMenuRadioItem
                className="rounded-lg"
                disabled={disabled}
                key={model.id}
                value={model.id}
              >
                <span className="flex w-full min-w-0 items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <AvailabilityDot liveness={liveness} />
                    <ModelLogo modelId={model.id} size={14} />
                    <span className="truncate font-medium text-xs">
                      {model.name}
                    </span>
                  </span>
                  {typeof workerCount === "number" && (
                    <span
                      className={cn(
                        "ml-auto shrink-0 font-mono text-[10px]",
                        workerCount === 0
                          ? "text-red-500"
                          : allBusy
                            ? "text-amber-500"
                            : "text-content-subtle"
                      )}
                    >
                      {workerCount === 0
                        ? "Offline"
                        : allBusy
                          ? "Busy"
                          : `${workerCount} online${speedHint(model.id)}`}
                    </span>
                  )}
                </span>
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
