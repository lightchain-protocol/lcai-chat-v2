"use client";

import { AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { FailoverStatus } from "@/lib/protocol/transport";
import { cn } from "@/lib/utils";

type SessionRecoveryBannerProps = {
  failoverStatus: FailoverStatus;
  onRetry?: () => void;
  onNewSession?: () => void;
  className?: string;
};

const STATUS_CONFIG: Record<
  Exclude<FailoverStatus, "none">,
  { text: string; showSpinner: boolean; actions: ("retry" | "newSession")[] }
> = {
  reassigning: {
    text: "Reassigning session to a new worker\u2026 (wallet approval required)",
    showSpinner: true,
    actions: [],
  },
  rewrapping: {
    text: "Securing session with new worker\u2026 (wallet approval required)",
    showSpinner: true,
    actions: [],
  },
  failed: {
    text: "Session recovery failed.",
    showSpinner: false,
    actions: ["retry", "newSession"],
  },
  rollover_required: {
    text: "This session cannot be recovered. Start a new session to continue.",
    showSpinner: false,
    actions: ["newSession"],
  },
};

export function SessionRecoveryBanner({
  failoverStatus,
  onRetry,
  onNewSession,
  className,
}: SessionRecoveryBannerProps) {
  if (failoverStatus === "none") return null;

  const config = STATUS_CONFIG[failoverStatus];

  return (
    <div
      className={cn(
        "mx-auto flex w-full max-w-3xl items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm dark:border-amber-900 dark:bg-amber-950/50",
        className,
      )}
    >
      {config.showSpinner ? (
        <Loader2 className="size-4 shrink-0 animate-spin text-amber-600 dark:text-amber-400" />
      ) : (
        <AlertCircle className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
      )}

      <span className="flex-1 text-amber-800 dark:text-amber-200">
        {config.text}
      </span>

      <div className="flex shrink-0 gap-2">
        {config.actions.includes("retry") && onRetry && (
          <Button
            onClick={onRetry}
            size="sm"
            variant="outline"
          >
            Retry
          </Button>
        )}
        {config.actions.includes("newSession") && onNewSession && (
          <Button
            onClick={onNewSession}
            size="sm"
            variant="outline"
          >
            New Session
          </Button>
        )}
      </div>
    </div>
  );
}
