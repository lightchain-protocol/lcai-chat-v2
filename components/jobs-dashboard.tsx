"use client";

import { Clock, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import type { DashboardJob } from "@/app/(chat)/jobs/page";
import config from "@/config";
import { jobRegistryAbi } from "@/contracts/job-registry-abi";
import useWeb3Clients from "@/hooks/use-web3-clients";
import { $http } from "@/lib/http";
import { getWeb3ErrorMessage } from "@/lib/utils/web3-errors";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";

const JOB_STATE_LABELS: Record<string, string> = {
  submitted: "Submitted",
  acknowledged: "Acknowledged",
  completed: "Completed",
  timedout: "Timed Out",
  timed_out: "Timed Out",
  disputed: "Disputed",
  resolved: "Resolved",
  released: "Released",
};

const JOB_STATE_VARIANTS: Record<
  string,
  "default" | "secondary" | "outline" | "destructive"
> = {
  submitted: "secondary",
  acknowledged: "secondary",
  completed: "default",
  timedout: "destructive",
  timed_out: "destructive",
  disputed: "outline",
  resolved: "default",
  released: "default",
};

type JobsDashboardProps = {
  initialJobs: DashboardJob[];
};

export function JobsDashboard({ initialJobs }: JobsDashboardProps) {
  const [jobs, setJobs] = useState<DashboardJob[]>(initialJobs);
  const [txPending, setTxPending] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const { publicClient, walletClient } = useWeb3Clients();
  const protocolChainId = config.chains[0].id;
  const jobRegistryAddress = config.jobRegistryAddress[protocolChainId];

  const refreshJobs = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await $http.get("/api/jobs");
      if (!res.ok) {
        toast.error("Could not refresh jobs");
        return;
      }
      const nextJobs = (await res.json()) as DashboardJob[];
      setJobs(nextJobs);
    } catch {
      toast.error("Could not refresh jobs");
    } finally {
      setRefreshing(false);
    }
  }, []);

  const handleClaimTimeout = async (job: DashboardJob) => {
    if (!walletClient?.account || !jobRegistryAddress || !publicClient) return;
    if (!job.jobId) return;
    setTxPending(job.jobId);
    try {
      const callParams = {
        account: walletClient.account,
        address: jobRegistryAddress,
        abi: jobRegistryAbi,
        functionName: "claimTimeout",
        args: [BigInt(job.jobId)],
      } as const;
      const gasEstimate = await publicClient.estimateContractGas(callParams);
      const { request } = await publicClient.simulateContract({
        ...callParams,
        gas: (gasEstimate * 120n) / 100n,
      });
      const hash = await walletClient.writeContract(request);
      await publicClient.waitForTransactionReceipt({ hash });
      toast.success(`Job #${job.jobId}: fee refunded, worker slashed.`);
      await refreshJobs();
    } catch (err) {
      toast.error(getWeb3ErrorMessage(err));
    } finally {
      setTxPending(null);
    }
  };

  return (
    <div className="mx-auto flex h-full w-full max-w-5xl flex-col gap-6 px-4 py-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-semibold text-2xl text-content-strong">
            On-chain Jobs
          </h1>
          <p className="mt-1 text-content-default text-sm">
            Track your encrypted AI jobs and take action on timed-out.
          </p>
        </div>

        <Button
          className="gap-2"
          disabled={refreshing}
          onClick={refreshJobs}
          size="sm"
          type="button"
          variant="outline"
        >
          <RefreshCw
            className={refreshing ? "size-4 animate-spin" : "size-4"}
          />
          Refresh
        </Button>
      </div>

      {jobs.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-content-default">
          <p className="text-sm">No on-chain jobs found.</p>
          <Link className="text-primary text-sm underline" href="/">
            Start a new chat
          </Link>
        </div>
      ) : (
        <div className="overflow-auto rounded-2xl border border-bdr-light">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-bdr-light border-b bg-surface-base-faint text-content-default text-xs">
                <th className="px-4 py-3 text-left font-medium">Job ID</th>
                <th className="px-4 py-3 text-left font-medium">Chat</th>
                <th className="px-4 py-3 text-left font-medium">State</th>
                <th className="px-4 py-3 text-left font-medium">Submitted</th>
                <th className="px-4 py-3 text-left font-medium">Completed</th>
                <th className="px-4 py-3 text-left font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr
                  className="border-bdr-light border-b last:border-0 hover:bg-surface-base-faint/50"
                  key={`${job.jobId}-${job.messageId}`}
                >
                  <td className="px-4 py-3 font-mono text-content-strong">
                    {job.jobId ? `#${job.jobId}` : "—"}
                  </td>

                  <td className="px-4 py-3">
                    <Link
                      className="flex items-center gap-1 text-primary hover:underline"
                      href={`/chat/${job.chatId}`}
                    >
                      <span className="max-w-[14ch] truncate">
                        {job.chatTitle ?? job.chatId.slice(0, 8)}
                      </span>
                      <ExternalLink className="size-3 shrink-0" />
                    </Link>
                  </td>

                  <td className="px-4 py-3">
                    <Badge
                      variant={
                        (job.indexer?.state &&
                          JOB_STATE_VARIANTS[job.indexer.state]) ||
                        "secondary"
                      }
                    >
                      {(job.indexer?.state &&
                        JOB_STATE_LABELS[job.indexer.state]) ||
                        "Unknown"}
                    </Badge>
                  </td>

                  <td className="px-4 py-3 text-content-default">
                    {new Date(job.createdAt).toLocaleString()}
                  </td>

                  <td className="px-4 py-3 text-content-default">
                    {job.indexer?.completedAt
                      ? new Date(
                          job.indexer.completedAt * 1000
                        ).toLocaleString()
                      : "—"}
                  </td>

                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {job.indexer?.canClaimTimeout && job.jobId && (
                        <Button
                          className="h-7 gap-1 px-2 text-xs"
                          disabled={txPending === job.jobId}
                          onClick={() => handleClaimTimeout(job)}
                          size="sm"
                          type="button"
                          variant="outline"
                        >
                          {txPending === job.jobId ? (
                            <Loader2 className="size-3 animate-spin" />
                          ) : (
                            <Clock className="size-3" />
                          )}
                          Claim Timeout
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
