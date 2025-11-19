"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import type { SubscriptionTierType } from "@/config/subscription";
import type { AppUsage } from "@/lib/usage";
import {
  getTokenLimit,
  getUsagePercentage,
  getWarningLevel,
} from "@/lib/usage";

type UseUsageWarningsProps = {
  usage: AppUsage | undefined;
  subscriptionTier?: SubscriptionTierType;
  onUpgradeClick?: () => void;
};

/**
 * Hook to display usage warnings based on token consumption
 * Shows toast notifications at 70%, 85%, and 95% thresholds
 */
export function useUsageWarnings({
  usage,
  subscriptionTier = "basic",
  onUpgradeClick,
}: UseUsageWarningsProps) {
  const lastWarningLevel = useRef<"none" | "info" | "warning" | "critical">(
    "none"
  );

  useEffect(() => {
    if (!usage) return;

    const totalTokens = usage.totalTokens ?? 0;
    const limit = getTokenLimit(subscriptionTier);
    const percentage = getUsagePercentage(totalTokens, limit);
    const currentLevel = getWarningLevel(percentage);

    // Only show toast if warning level has increased
    if (
      currentLevel !== "none" &&
      shouldShowWarning(lastWarningLevel.current, currentLevel)
    ) {
      showWarningToast(currentLevel, percentage, onUpgradeClick);
      lastWarningLevel.current = currentLevel;
    }
  }, [usage, subscriptionTier, onUpgradeClick]);

  const totalTokens = usage?.totalTokens ?? 0;
  const limit = getTokenLimit(subscriptionTier);
  const percentage = getUsagePercentage(totalTokens, limit);
  const warningLevel = getWarningLevel(percentage);

  return {
    percentage,
    warningLevel,
    limit,
    used: totalTokens,
  };
}

/**
 * Determine if we should show a new warning
 */
function shouldShowWarning(
  lastLevel: "none" | "info" | "warning" | "critical",
  currentLevel: "none" | "info" | "warning" | "critical"
): boolean {
  const levels = ["none", "info", "warning", "critical"];
  const lastIndex = levels.indexOf(lastLevel);
  const currentIndex = levels.indexOf(currentLevel);
  return currentIndex > lastIndex;
}

/**
 * Show appropriate warning toast based on level
 */
function showWarningToast(
  level: "info" | "warning" | "critical",
  percentage: number,
  onUpgradeClick?: () => void
) {
  const roundedPercentage = percentage.toFixed(0);

  if (level === "critical") {
    toast.error(`⚠️ ${roundedPercentage}% of token limit reached!`, {
      description: "Consider upgrading your plan to continue.",
      action: onUpgradeClick
        ? {
            label: "Upgrade",
            onClick: onUpgradeClick,
          }
        : undefined,
      duration: 10_000,
    });
  } else if (level === "warning") {
    toast.warning(`⚠️ ${roundedPercentage}% of token limit reached`, {
      description: "You're approaching your monthly limit.",
      duration: 7000,
    });
  } else if (level === "info") {
    toast.info(`ℹ️ ${roundedPercentage}% of token limit reached`, {
      description: "Your token usage is increasing.",
      duration: 5000,
    });
  }
}
