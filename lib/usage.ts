import type { LanguageModelUsage } from "ai";
import type { UsageData } from "tokenlens/helpers";
import { type SubscriptionTierType, tokenLimits } from "@/config/subscription";

// Server-merged usage: base usage + TokenLens summary + optional modelId
export type AppUsage = LanguageModelUsage & UsageData & { modelId?: string };

// Warning thresholds as percentages
export const WARNING_THRESHOLDS = {
  info: 70, // 70% - informational warning
  warning: 85, // 85% - warning
  critical: 95, // 95% - critical warning
} as const;

/**
 * Get the token limit for a subscription tier
 */
export function getTokenLimit(tier: SubscriptionTierType = "basic"): number {
  return tokenLimits[tier];
}

/**
 * Calculate usage percentage
 */
export function getUsagePercentage(usedTokens: number, limit: number): number {
  if (!limit || limit <= 0) return 0;
  return Math.min(100, (usedTokens / limit) * 100);
}

/**
 * Get warning level based on usage percentage
 */
export function getWarningLevel(
  percentage: number
): "none" | "info" | "warning" | "critical" {
  if (percentage >= WARNING_THRESHOLDS.critical) return "critical";
  if (percentage >= WARNING_THRESHOLDS.warning) return "warning";
  if (percentage >= WARNING_THRESHOLDS.info) return "info";
  return "none";
}
