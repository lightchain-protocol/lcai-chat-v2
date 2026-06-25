"use client";

import { Clock, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { formatEther } from "viem";
import config from "@/config";
import { aiConfigAbi } from "@/contracts/ai-config-abi";
import { jobRegistryAbi } from "@/contracts/job-registry-abi";
import useWeb3Clients from "@/hooks/use-web3-clients";
import type { TrackedJob } from "@/lib/protocol/transport";
import { getWeb3ErrorMessage } from "@/lib/utils/web3-errors";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { Button } from "./ui/button";

type MessageJobActionsProps = {
  jobId: number;
  messageRole: "user" | "assistant";
  /** Active job from transport, if tracked. */
  trackedJob: TrackedJob | undefined;
  onClaimTimeout?: (jobId: number) => Promise<{ txHash: string }>;
  onDisputeJob?: (jobId: number) => Promise<{ txHash: string; bond: bigint }>;
};

/**
 * Renders inline protocol action buttons below a chat message:
 *  - User messages: "Claim Timeout" when the job has timed out.
 *  - Assistant messages: "Dispute" when the job is Completed and within the dispute window.
 */
export function MessageJobActions({
  jobId,
  messageRole,
  trackedJob,
  onClaimTimeout,
  onDisputeJob,
}: MessageJobActionsProps) {
  const [claimPending, setClaimPending] = useState(false);
  const [disputePending, setDisputePending] = useState(false);
  const [showDisputeDialog, setShowDisputeDialog] = useState(false);
  const [disputeBond, setDisputeBond] = useState<bigint | null>(null);

  const { publicClient } = useWeb3Clients();
  const protocolChainId = config.chains[0].id;
  const jobRegistryAddress = config.jobRegistryAddress[protocolChainId];
  const aiConfigAddress = config.aiConfigAddress[protocolChainId];

  // ── Claim Timeout (user message, job timed out) ──────────────────────────
  if (
    messageRole === "user" &&
    trackedJob?.status === "timed_out" &&
    onClaimTimeout
  ) {
    const handleClaim = async () => {
      setClaimPending(true);
      try {
        await onClaimTimeout(jobId);
        toast.success("Job fee refunded. Worker slashed.");
      } catch (err) {
        toast.error(`Claim failed: ${getWeb3ErrorMessage(err)}`);
      } finally {
        setClaimPending(false);
      }
    };

    return (
      <div className="mt-1 flex items-center gap-2">
        <Button
          className="h-6 gap-1 border-amber-300 px-2 text-amber-700 text-xs hover:bg-amber-50 dark:border-amber-700 dark:text-amber-300 dark:hover:bg-amber-950/40"
          disabled={claimPending}
          onClick={handleClaim}
          size="sm"
          type="button"
          variant="outline"
        >
          <Clock className="size-3" />
          {claimPending ? "Claiming…" : "Claim Timeout"}
        </Button>
      </div>
    );
  }

  // ── Dispute (assistant message, job completed within window) ─────────────
  if (messageRole === "assistant" && onDisputeJob) {
    // Only show button when the job is completed and we haven't already disputed
    if (
      trackedJob &&
      (trackedJob.status === "completed" || trackedJob.status === "streaming")
    ) {
      const openDisputeDialog = async () => {
        if (!publicClient || !jobRegistryAddress || !aiConfigAddress) return;

        try {
          const [job, multiplier] = await Promise.all([
            publicClient.readContract({
              address: jobRegistryAddress,
              abi: jobRegistryAbi,
              functionName: "getJob",
              args: [BigInt(jobId)],
            }),
            publicClient.readContract({
              address: aiConfigAddress,
              abi: aiConfigAbi,
              functionName: "getDisputeBondMultiplier",
            }),
          ]);

          // JobState.Completed == 2
          if (job.state !== 2) return;

          const disputeWindow = await publicClient.readContract({
            address: aiConfigAddress,
            abi: aiConfigAbi,
            functionName: "getDisputeWindow",
          });

          const windowEnd = Number(job.completedAt) + Number(disputeWindow);
          if (Date.now() / 1000 >= windowEnd) return; // window closed

          const bond = (job.escrowedFee * multiplier) / 10_000n;
          setDisputeBond(bond);
          setShowDisputeDialog(true);
        } catch {
          // Job not readable — don't show button
        }
      };

      const handleDispute = async () => {
        setShowDisputeDialog(false);
        setDisputePending(true);
        try {
          await onDisputeJob(jobId);
          toast.success("Dispute filed successfully.");
        } catch (err) {
          toast.error(`Dispute failed: ${getWeb3ErrorMessage(err)}`);
        } finally {
          setDisputePending(false);
        }
      };

      return (
        <>
          <div className="mt-1 flex items-center gap-2">
            <Button
              className="h-6 gap-1 border-blue-300 px-2 text-blue-700 text-xs hover:bg-blue-50 dark:border-blue-700 dark:text-blue-300 dark:hover:bg-blue-950/40"
              disabled={disputePending}
              onClick={openDisputeDialog}
              size="sm"
              type="button"
              variant="outline"
            >
              <ShieldAlert className="size-3" />
              {disputePending ? "Disputing…" : "Dispute Response"}
            </Button>
          </div>

          <AlertDialog
            onOpenChange={setShowDisputeDialog}
            open={showDisputeDialog}
          >
            <AlertDialogContent className="sm:rounded-3xl">
              <AlertDialogHeader>
                <AlertDialogTitle>File a Dispute?</AlertDialogTitle>
                <AlertDialogDescription>
                  You are disputing job #{jobId}. A bond of{" "}
                  <strong>
                    {disputeBond !== null ? formatEther(disputeBond) : "…"} LCAI
                  </strong>{" "}
                  will be deducted from your wallet. If the worker is found
                  guilty the bond is refunded and the fee is returned to you. If
                  the worker is cleared, the bond is forfeited.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleDispute}>
                  Confirm Dispute
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      );
    }
  }

  return null;
}
