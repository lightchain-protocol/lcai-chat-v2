"use client";

import { Hourglass } from "lucide-react";
import { cn } from "@/lib/utils";

type NoWorkersNoticeProps = {
  /**
   * Whether any worker is registered for the selected models at all, as
   * opposed to all of them being mid-job. The two cases wait very differently
   * and the copy should not pretend otherwise.
   */
  hasEligibleWorkers: boolean;
  className?: string;
};

/**
 * Sits inside the composer when no worker can take a prompt.
 *
 * Styled as an inset panel rather than an alert: this is not an error, it is a
 * queue. The composer is `rounded-[20px] border-bdr-soft bg-surface-elevation-light`,
 * so this nests one step tighter and one surface deeper, and borrows the brand
 * accent rather than a red or amber that would read as something having broken.
 */
export function NoWorkersNotice({
  hasEligibleWorkers,
  className,
}: NoWorkersNoticeProps) {
  return (
    <div
      className={cn(
        "mb-3 flex items-center gap-3 rounded-[14px] border border-bdr-soft bg-surface-base-faint px-3 py-2.5",
        className
      )}
      data-testid="no-workers-notice"
    >
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-base-brand-default/10">
        <Hourglass className="size-3.5 text-surface-base-brand-strong" />
      </span>

      <div className="min-w-0 flex-1">
        <p className="font-medium text-content-strong text-sm">
          {hasEligibleWorkers
            ? "Every worker is busy"
            : "No workers are online"}
        </p>
        <p className="mt-0.5 text-content-medium text-xs">
          {hasEligibleWorkers
            ? "Your prompt would not be picked up yet. This clears as jobs finish."
            : "Nothing is available to answer the selected models right now."}
        </p>
      </div>
    </div>
  );
}
