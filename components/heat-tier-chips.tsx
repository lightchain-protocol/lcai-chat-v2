"use client";

import { memo } from "react";
import type { HeatTier } from "@/lib/ai/heat-tiers";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";

/**
 * Standard | Max tier chips, sitting left of the model picker.
 *
 * Max is a paid quality tier (a separate `{base}-max` catalogue entry with its
 * own fee), so the chip is honest about availability: when the selected model
 * has no Max entry the chip renders disabled with the reason, instead of
 * arming a tier the network can't deliver. The pre-send price line next to it
 * (in multimodal-input) states the fee before money moves.
 */
function PureHeatTierChips({
  tier,
  onTierChange,
  maxAvailable,
}: {
  tier: HeatTier;
  onTierChange: (tier: HeatTier) => void;
  /** False when the catalogue has no `{base}-max` entry for the selection. */
  maxAvailable: boolean;
}) {
  const chip = (value: HeatTier, label: string) => {
    const active = tier === value;
    const disabled = value === "max" && !maxAvailable;
    return (
      <Button
        aria-label={`${label} tier`}
        aria-pressed={active}
        className={cn(
          "h-8 rounded-lg px-2 font-normal text-xs",
          active
            ? "bg-primary/10 text-primary"
            : "text-content-secondary opacity-60",
          disabled && "cursor-not-allowed opacity-30"
        )}
        data-testid={`heat-tier-${value}`}
        disabled={disabled}
        onClick={(event) => {
          event.preventDefault();
          if (!disabled) {
            onTierChange(value);
          }
        }}
        title={
          disabled
            ? "No Max variant of this model is registered yet"
            : value === "max"
              ? "Max tier: the higher-quality variant of the selected model, at its own fee"
              : "Standard tier"
        }
        type="button"
        variant="ghost"
      >
        {label}
      </Button>
    );
  };

  return (
    <span className="flex items-center" data-testid="heat-tier-chips">
      {chip("standard", "Standard")}
      {chip("max", "Max")}
    </span>
  );
}

export const HeatTierChips = memo(PureHeatTierChips);
