"use client";

import type { ComponentProps } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import type { SubscriptionTierType } from "@/config/subscription";
import type { AppUsage } from "@/lib/usage";
import {
  getTokenLimit,
  getUsagePercentage,
  getWarningLevel,
} from "@/lib/usage";
import { cn } from "@/lib/utils";

export type ContextProps = ComponentProps<"button"> & {
  /** Optional full usage payload to enable breakdown view */
  usage?: AppUsage;
  /** Subscription tier for token limit calculations */
  subscriptionTier?: SubscriptionTierType;
};

const _THOUSAND = 1000;
const _MILLION = 1_000_000;
const _BILLION = 1_000_000_000;
const PERCENT_MAX = 100;

// Lucide CircleIcon geometry
const ICON_VIEWBOX = 24;
const ICON_CENTER = 12;
const ICON_RADIUS = 10;
const ICON_STROKE_WIDTH = 2;

type ContextIconProps = {
  percent: number; // 0 - 100
  warningLevel?: "none" | "info" | "warning" | "critical";
};

export const ContextIcon = ({
  percent,
  warningLevel = "none",
}: ContextIconProps) => {
  const radius = ICON_RADIUS;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - percent / PERCENT_MAX);

  // Determine color based on warning level
  const colorClass = {
    none: "text-current",
    info: "text-blue-500",
    warning: "text-yellow-500",
    critical: "text-red-500",
  }[warningLevel];

  return (
    <svg
      aria-label={`${percent.toFixed(2)}% of model context used`}
      className={colorClass}
      height="28"
      role="img"
      viewBox={`0 0 ${ICON_VIEWBOX} ${ICON_VIEWBOX}`}
      width="28"
    >
      <circle
        cx={ICON_CENTER}
        cy={ICON_CENTER}
        fill="none"
        opacity="0.25"
        r={radius}
        stroke="currentColor"
        strokeWidth={ICON_STROKE_WIDTH}
      />
      <circle
        cx={ICON_CENTER}
        cy={ICON_CENTER}
        fill="none"
        opacity="0.7"
        r={radius}
        stroke="currentColor"
        strokeDasharray={`${circumference} ${circumference}`}
        strokeDashoffset={dashOffset}
        strokeLinecap="round"
        strokeWidth={ICON_STROKE_WIDTH}
        transform={`rotate(-90 ${ICON_CENTER} ${ICON_CENTER})`}
      />
    </svg>
  );
};

function InfoRow({
  label,
  tokens,
  costText,
}: {
  label: string;
  tokens?: number;
  costText?: string;
}) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2 font-mono">
        <span className="min-w-[4ch] text-right">
          {tokens === undefined ? "—" : tokens.toLocaleString()}
        </span>
        {costText !== undefined &&
          costText !== null &&
          !Number.isNaN(Number.parseFloat(costText)) && (
            <span className="text-muted-foreground">
              ${Number.parseFloat(costText).toFixed(6)}
            </span>
          )}
      </div>
    </div>
  );
}

export const Context = ({
  className,
  usage,
  subscriptionTier = "basic",
  ...props
}: ContextProps) => {
  const used = usage?.totalTokens ?? 0;
  // const max =
  //   usage?.context?.totalMax ??
  //   usage?.context?.combinedMax ??
  //   usage?.context?.inputMax;
  // const hasMax = typeof max === "number" && Number.isFinite(max) && max > 0;
  // const usedPercent = hasMax ? Math.min(100, (used / max) * 100) : 0;

  // Calculate usage warning for subscription limits
  const max = getTokenLimit(subscriptionTier);
  const hasMax = typeof max === "number" && Number.isFinite(max) && max > 0;
  const usedPercent = hasMax ? Math.min(100, (used / max) * 100) : 0;

  const subscriptionUsagePercent = getUsagePercentage(used, max);
  const warningLevel = getWarningLevel(subscriptionUsagePercent);

  // Determine text color based on warning level
  const textColorClass = {
    none: "text-muted-foreground",
    info: "text-blue-600 dark:text-blue-400",
    warning: "text-yellow-600 dark:text-yellow-400",
    critical: "text-red-600 dark:text-red-400",
  }[warningLevel];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            "inline-flex select-none items-center gap-1 rounded-md text-sm",
            "cursor-pointer text-foreground",
            className
          )}
          type="button"
          {...props}
        >
          <span className={cn("hidden font-medium", textColorClass)}>
            {usedPercent.toFixed(1)}%
          </span>
          <ContextIcon percent={usedPercent} warningLevel={warningLevel} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-fit p-3" side="top">
        <div className="min-w-[240px] space-y-2">
          <div className="flex items-start justify-between text-sm">
            <span>{usedPercent.toFixed(1)}%</span>
            <span className="text-muted-foreground">
              {hasMax
                ? `${used.toLocaleString()} / ${max.toLocaleString()} tokens`
                : `${used.toLocaleString()} tokens`}
            </span>
          </div>
          <div className="space-y-2">
            <Progress
              barClassName={cn(
                "bg-primary",
                warningLevel === "critical" && "bg-red-500",
                warningLevel === "warning" && "bg-yellow-500",
                warningLevel === "info" && "bg-blue-500"
              )}
              className={cn(
                "h-1.5 bg-muted",
                warningLevel === "critical" && "bg-red-100 dark:bg-red-950",
                warningLevel === "warning" &&
                  "bg-yellow-100 dark:bg-yellow-950",
                warningLevel === "info" && "bg-blue-100 dark:bg-blue-950"
              )}
              value={usedPercent}
            />
          </div>
          <div className="mt-1 space-y-1">
            {usage?.cachedInputTokens && usage.cachedInputTokens > 0 && (
              <InfoRow
                costText={usage?.costUSD?.cacheReadUSD?.toString()}
                label="Cache Hits"
                tokens={usage?.cachedInputTokens}
              />
            )}
            <InfoRow
              costText={usage?.costUSD?.inputUSD?.toString()}
              label="Input"
              tokens={usage?.inputTokens}
            />
            <InfoRow
              costText={usage?.costUSD?.outputUSD?.toString()}
              label="Output"
              tokens={usage?.outputTokens}
            />
            <InfoRow
              costText={usage?.costUSD?.reasoningUSD?.toString()}
              label="Reasoning"
              tokens={
                usage?.reasoningTokens && usage.reasoningTokens > 0
                  ? usage.reasoningTokens
                  : undefined
              }
            />
            {usage?.costUSD?.totalUSD !== undefined && (
              <>
                <Separator className="mt-1" />
                <div className="flex items-center justify-between pt-1 text-xs">
                  <span className="text-muted-foreground">Total cost</span>
                  <div className="flex items-center gap-2 font-mono">
                    <span className="min-w-[4ch] text-right" />
                    <span>
                      {Number.isNaN(
                        Number.parseFloat(usage.costUSD.totalUSD.toString())
                      )
                        ? "—"
                        : `$${Number.parseFloat(usage.costUSD.totalUSD.toString()).toFixed(6)}`}
                    </span>
                  </div>
                </div>
              </>
            )}
            {/* <Separator className="mt-2" />
            <div className="pt-1">
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Monthly usage</span>
                <span className={cn("font-medium", textColorClass)}>
                  {subscriptionUsagePercent.toFixed(0)}%
                </span>
              </div>
              <Progress
                className={cn(
                  "h-1.5 bg-muted",
                  warningLevel === "critical" && "bg-red-100 dark:bg-red-950",
                  warningLevel === "warning" &&
                    "bg-yellow-100 dark:bg-yellow-950",
                  warningLevel === "info" && "bg-blue-100 dark:bg-blue-950"
                )}
                value={subscriptionUsagePercent}
              />
              <div className="mt-1 flex items-center justify-between text-xs">
                <span className="text-muted-foreground">
                  {used.toLocaleString()} / {max.toLocaleString()} tokens
                </span>
              </div>
            </div> */}
          </div>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
