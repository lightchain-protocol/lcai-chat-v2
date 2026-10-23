"use client";

import { Clock, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import type { TrackedJob } from "@/lib/protocol/transport";
import { Button } from "./ui/button";
import AlertCloseButton from "./ui/toast/AlertCloseButton";
import WarningIconSvg from "./ui/toast/WarningIconSvg";

type JobTimeoutToastProps = {
  id: string | number;
  job: TrackedJob;
  onClaim: (jobId: number) => Promise<{ txHash: string }>;
  onNewSession: () => void;
};

export function JobTimeoutToast({
  id,
  job,
  onClaim,
  onNewSession,
}: JobTimeoutToastProps) {
  const handleClaim = async () => {
    toast.dismiss(id);
    try {
      await onClaim(job.jobId);
      toast.success("Job fee refunded. Worker slashed.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Transaction failed";
      toast.error(`Claim failed: ${msg}`);
    }
  };

  const handleNewSession = () => {
    toast.dismiss(id);
    onNewSession();
  };

  return (
    <div className="relative w-full min-w-75 rounded-[20px] bg-linear-to-r from-[#f5c10436] to-[#f5c10413] p-0.5 sm:min-w-90 dark:from-[#f5c10456] dark:to-[#f5c10421]">
      <div className="flex w-full items-start gap-3 rounded-[18px] bg-[linear-gradient(90deg,#FFEFD3_0%,#FFFDF9_38.81%)] px-4 py-3 shadow-[0_8px_36px_rgba(0,0,0,0.10)] dark:bg-[linear-gradient(90deg,#463704_0%,#261D00_70.83%)] dark:shadow-[-10px_0_30px_rgba(152,120,0,0.30),0_20px_40px_rgba(0,0,0,0.40)]">
        <span className="relative z-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(180deg,#FDC700_0%,#977700_100%)] text-xl shadow-[0_4px_24px_rgba(0,0,0,0.24),inset_0_0_4px_rgba(255,255,255,0.25)]">
          <WarningIconSvg />
        </span>

        <div className="relative z-2 flex min-w-0 flex-1 flex-col gap-2">
          <h6 className="text-[#7A2E0E] text-label-16-medium dark:text-white">
            Worker hasn&apos;t responded
          </h6>
          <p className="text-[#DC6803] text-sm dark:text-content-default">
            Job #{job.jobId} timed out. You can claim a refund and slash the
            worker, or start a new session to retry.
          </p>

          <div className="flex flex-wrap gap-2 pt-1">
            <Button
              className="h-7 gap-1.5 px-3 text-xs"
              onClick={handleClaim}
              size="sm"
              type="button"
              variant="outline"
            >
              <Clock className="size-3" />
              Claim Timeout
            </Button>
            <Button
              className="h-7 gap-1.5 px-3 text-xs"
              onClick={handleNewSession}
              size="sm"
              type="button"
              variant="outline"
            >
              <RefreshCw className="size-3" />
              Start New Session
            </Button>
          </div>
        </div>

        <AlertCloseButton id={id} />
      </div>
    </div>
  );
}
