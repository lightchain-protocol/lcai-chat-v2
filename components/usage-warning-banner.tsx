"use client";

import { AlertCircle, Info, XIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { SubscriptionTierType } from "@/config/subscription";
import {
  getTokenLimit,
  getUsagePercentage,
  getWarningLevel,
} from "@/lib/usage";
import { cn } from "@/lib/utils";

type UsageWarningBannerProps = {
  totalTokens: number;
  subscriptionTier?: SubscriptionTierType;
  onUpgradeClick?: () => void;
  className?: string;
};

/**
 * Banner component that displays usage warnings
 * Shows when user is at 70%, 85%, or 95% of their token limit
 */
export function UsageWarningBanner({
  totalTokens,
  subscriptionTier = "basic",
  onUpgradeClick,
  className,
}: UsageWarningBannerProps) {
  const [dismissed, setDismissed] = useState(false);

  const limit = getTokenLimit(subscriptionTier);
  const percentage = getUsagePercentage(totalTokens, limit);
  const warningLevel = getWarningLevel(percentage);

  // Don't show banner if no warning or dismissed
  if (warningLevel === "none" || dismissed) {
    return null;
  }

  const bannerConfig = {
    info: {
      bgColor: "bg-blue-50 dark:bg-blue-950/20",
      borderColor: "border-blue-200 dark:border-blue-900",
      textColor: "text-blue-900 dark:text-blue-100",
      iconColor: "text-blue-600 dark:text-blue-400",
      icon: Info,
      title: "Token Usage Notice",
      message: `You've used ${percentage.toFixed(0)}% of your monthly token limit.`,
    },
    warning: {
      bgColor: "bg-yellow-50 dark:bg-yellow-950/20",
      borderColor: "border-yellow-200 dark:border-yellow-900",
      textColor: "text-yellow-900 dark:text-yellow-100",
      iconColor: "text-yellow-600 dark:text-yellow-400",
      icon: AlertCircle,
      title: "Token Usage Warning",
      message: `You've used ${percentage.toFixed(0)}% of your monthly token limit. Consider upgrading to avoid interruptions.`,
    },
    critical: {
      bgColor: "bg-red-50 dark:bg-red-950/20",
      borderColor: "border-red-200 dark:border-red-900",
      textColor: "text-red-900 dark:text-red-100",
      iconColor: "text-red-600 dark:text-red-400",
      icon: AlertCircle,
      title: "Critical: Token Limit Almost Reached",
      message: `You've used ${percentage.toFixed(0)}% of your monthly token limit! Upgrade now to continue using the service.`,
    },
  };

  const config = bannerConfig[warningLevel];
  const Icon = config.icon;

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-lg border p-4",
        config.bgColor,
        config.borderColor,
        className
      )}
    >
      <Icon className={cn("mt-0.5 h-5 w-5 flex-shrink-0", config.iconColor)} />

      <div className="flex-1 space-y-1">
        <div className={cn("font-medium text-sm", config.textColor)}>
          {config.title}
        </div>
        <div className={cn("text-sm", config.textColor)}>{config.message}</div>
        <div className={cn("mt-2 text-xs", config.textColor)}>
          {totalTokens.toLocaleString()} / {limit.toLocaleString()} tokens used
        </div>
      </div>

      <div className="flex items-center gap-2">
        {onUpgradeClick && (
          <Button
            onClick={onUpgradeClick}
            size="sm"
            variant={warningLevel === "critical" ? "default" : "outline"}
          >
            Upgrade
          </Button>
        )}
        <Button
          className={cn("h-8 w-8 p-0", config.iconColor)}
          onClick={() => setDismissed(true)}
          size="sm"
          variant="ghost"
        >
          <XIcon className="h-4 w-4" />
          <span className="sr-only">Dismiss</span>
        </Button>
      </div>
    </div>
  );
}
