"use client";

import type { Session } from "next-auth";
import { startTransition, useMemo, useOptimistic, useState } from "react";
import { saveChatModelAsCookie } from "@/app/(chat)/actions";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useModels } from "@/hooks/use-models";
import { type Availability, availabilityOf } from "@/lib/ai/availability";
import { cn } from "@/lib/utils";
import { CheckCircleFillIcon, ChevronDownIcon } from "./icons";

/** Above this many live models the dropdown grows a name filter. */
const SEARCH_THRESHOLD = 6;

export function ModelSelector({
  selectedModelId,
  className,
}: {
  /**
   * Kept for call-site compatibility; the live model list is worker-gated by
   * the gateway (useModels), so per-user entitlement filtering is no longer
   * applied here.
   */
  session?: Session;
  selectedModelId: string;
} & React.ComponentProps<typeof Button>) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [optimisticModelId, setOptimisticModelId] =
    useOptimistic(selectedModelId);

  // Live, worker-availability-aware list ({ id, name }). A model only appears
  // once at least one worker is serving it, so there is nothing to filter by
  // entitlement here.
  const { models } = useModels();

  const selectedModel = useMemo(
    () => models.find((model) => model.id === optimisticModelId),
    [optimisticModelId, models]
  );

  const showSearch = models.length > SEARCH_THRESHOLD;

  const filteredModels = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return models;
    }
    return models.filter((model) => model.name.toLowerCase().includes(needle));
  }, [models, query]);

  return (
    <DropdownMenu
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setQuery("");
        }
      }}
      open={open}
    >
      <DropdownMenuTrigger
        asChild
        className={cn(
          "w-fit data-[state=open]:bg-accent data-[state=open]:text-accent-foreground",
          className
        )}
      >
        <Button
          className="gap-2 md:h-[34px] md:px-2"
          data-testid="model-selector"
          variant="outline"
        >
          {selectedModel && <AvailabilityDot modelId={selectedModel.id} />}
          <span className="truncate">
            {selectedModel?.name ?? "Select model"}
          </span>
          <ChevronDownIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="min-w-[280px] max-w-[90vw] rounded-lg p-0 sm:min-w-[300px]"
      >
        {showSearch && (
          <div className="border-bdr-light border-b p-1.5">
            <input
              className="w-full rounded-md bg-surface-base-faint px-2 py-1 text-xs outline-none placeholder:text-content-subtle"
              onChange={(event) => setQuery(event.target.value)}
              // The menu's typeahead would otherwise swallow every keystroke.
              onKeyDown={(event) => event.stopPropagation()}
              placeholder="Search models"
              value={query}
            />
          </div>
        )}
        <div className="flex max-h-[320px] flex-col gap-px overflow-y-auto p-1">
          {filteredModels.length === 0 && (
            <p className="px-2 py-3 text-center text-content-subtle text-xs">
              {models.length === 0
                ? "No models available"
                : `No model matches “${query}”`}
            </p>
          )}
          {filteredModels.map((model) => {
            const { id } = model;
            const active = id === optimisticModelId;

            return (
              <DropdownMenuItem
                asChild
                className="rounded-lg py-1"
                data-active={active}
                data-testid={`model-selector-item-${id}`}
                key={id}
                onSelect={() => {
                  setOpen(false);
                  setQuery("");

                  startTransition(() => {
                    setOptimisticModelId(id);
                    saveChatModelAsCookie(id);
                  });
                }}
              >
                <button
                  className="group/item flex w-full flex-row items-center justify-between gap-2 sm:gap-4"
                  type="button"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <AvailabilityDot modelId={id} />
                    <span className="truncate text-sm">{model.name}</span>
                  </span>

                  <span className="shrink-0 text-foreground opacity-0 group-data-[active=true]/item:opacity-100 dark:text-foreground">
                    <CheckCircleFillIcon />
                  </span>
                </button>
              </DropdownMenuItem>
            );
          })}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const AVAILABILITY_STYLES: Record<
  Availability,
  { className: string; title: string }
> = {
  good: {
    className: "bg-emerald-500",
    title:
      "Recent jobs on this model completed — device-local signal from your last few jobs, not a fleet-wide measurement",
  },
  shaky: {
    className: "bg-amber-500",
    title:
      "A recent job on this model failed or timed out — device-local signal from your last few jobs, not a fleet-wide measurement",
  },
  unknown: {
    className: "bg-content-subtle/30",
    title: "No recent jobs on this model from this device yet",
  },
};

/** Small per-row availability dot (lib/ai/availability.ts — device-local). */
function AvailabilityDot({ modelId }: { modelId: string }) {
  const availability = availabilityOf(modelId);
  const style = AVAILABILITY_STYLES[availability];
  return (
    <span
      aria-label={`availability: ${availability}`}
      className={cn(
        "inline-block size-1.5 shrink-0 rounded-full",
        style.className
      )}
      data-testid={`availability-dot-${availability}`}
      role="img"
      title={style.title}
    />
  );
}
