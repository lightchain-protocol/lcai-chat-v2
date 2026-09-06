"use client";

import {
  ArrowUpRight,
  Check,
  Clock,
  Loader2,
  Receipt,
  RefreshCw,
  Wallet,
  X,
} from "lucide-react";
import Link from "next/link";
import { formatEther } from "viem";
import { useAccount } from "wagmi";
import { ConnectWalletButton } from "@/components/connect-wallet-button";
import {
  type JobStatus,
  type TransactionJob,
  useTransactionHistory,
} from "@/hooks/use-transaction-history";
import { explorerAddressUrl, explorerTxUrl } from "@/lib/explorer";
import { cn, formatNumber } from "@/lib/utils";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";

const STATUS_META: Record<
  JobStatus,
  {
    label: string;
    variant: "default" | "secondary" | "destructive";
    icon: typeof Check;
  }
> = {
  completed: { label: "Completed", variant: "default", icon: Check },
  pending: { label: "Pending", variant: "secondary", icon: Clock },
  failed: { label: "Failed", variant: "destructive", icon: X },
};

/** Amounts everywhere in the app read as `formatNumber(formatEther(wei))`. */
function formatLcai(wei: bigint): string {
  return formatNumber(formatEther(wei));
}

function truncate(hex: string): string {
  return hex.length > 12 ? `${hex.slice(0, 6)}…${hex.slice(-4)}` : hex;
}

function formatWhen(unixSeconds: number): string {
  if (!unixSeconds) return "—";
  return new Date(unixSeconds * 1000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** A small external-link chip to the block explorer. */
function TxLink({
  href,
  label,
  title,
}: {
  href: string;
  label: string;
  title?: string;
}) {
  return (
    <a
      className="inline-flex items-center gap-0.5 rounded-sm font-mono text-content-secondary text-xs transition-colors hover:text-content-strong hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      href={href}
      rel="noreferrer noopener"
      target="_blank"
      title={title}
    >
      {label}
      <ArrowUpRight className="shrink-0" size={11} />
    </a>
  );
}

function StatusBadge({ status }: { status: JobStatus }) {
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  return (
    <Badge className="gap-1" variant={meta.variant}>
      <Icon size={11} />
      {meta.label}
    </Badge>
  );
}

/** The explorer links shared by the desktop cell and the mobile card. */
function JobLinks({ job }: { job: TransactionJob }) {
  const hasAny =
    job.sessionTxHash || job.submitTxHash || job.completionTxHash || job.worker;
  if (!hasAny) return <span className="text-content-subtle text-xs">—</span>;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {job.submitTxHash && (
        <TxLink
          href={explorerTxUrl(job.submitTxHash)}
          label="submit"
          title={job.submitTxHash}
        />
      )}
      {job.completionTxHash && (
        <TxLink
          href={explorerTxUrl(job.completionTxHash)}
          label="settle"
          title={job.completionTxHash}
        />
      )}
      {!job.completionTxHash && job.sessionTxHash && (
        <TxLink
          href={explorerTxUrl(job.sessionTxHash)}
          label="session"
          title={job.sessionTxHash}
        />
      )}
      {job.worker && (
        <TxLink
          href={explorerAddressUrl(job.worker)}
          label={`worker ${truncate(job.worker)}`}
          title={job.worker}
        />
      )}
    </div>
  );
}

export function TransactionsPanel() {
  const { isConnected } = useAccount();
  const { jobs, totalSpentWei, isLoading, refresh } = useTransactionHistory();

  const showInitialLoading = isConnected && isLoading && jobs.length === 0;

  return (
    <div className="mx-auto flex h-full w-full max-w-5xl flex-col gap-6 px-4 py-8">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 font-semibold text-2xl text-content-strong">
            <Receipt className="size-6 text-content-soft" />
            Transactions &amp; costs
          </h1>
          <p className="mt-1 max-w-xl text-content-default text-sm">
            Your AI jobs, read straight from the chain. Every cost is the fee
            actually charged on-chain, and every row links to the block explorer
            so you can verify it yourself.
          </p>
        </div>

        {isConnected && (
          <Button
            className="gap-2"
            disabled={isLoading}
            onClick={refresh}
            size="sm"
            type="button"
            variant="outline"
          >
            <RefreshCw className={cn("size-4", isLoading && "animate-spin")} />
            Refresh
          </Button>
        )}
      </div>

      {/* ── Not connected ──────────────────────────────────────────────── */}
      {isConnected ? (
        <>
          {/* ── Total spent summary ────────────────────────────────────── */}
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-bdr-light bg-surface-base-faint/60 px-6 py-5">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Wallet className="size-5" />
              </div>
              <div>
                <p className="text-content-default text-xs uppercase tracking-wide">
                  Total spent
                </p>
                <p className="font-semibold text-2xl text-content-strong tabular-nums">
                  {formatLcai(totalSpentWei)}{" "}
                  <span className="font-normal text-base text-content-default">
                    LCAI
                  </span>
                </p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-content-default text-xs uppercase tracking-wide">
                Jobs
              </p>
              <p className="font-semibold text-2xl text-content-strong tabular-nums">
                {jobs.length}
              </p>
            </div>
          </div>

          {/* ── Body ───────────────────────────────────────────────────── */}
          {showInitialLoading ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-content-default">
              <Loader2 className="size-6 animate-spin text-content-soft" />
              <p className="text-sm">Reading your jobs from the chain…</p>
            </div>
          ) : jobs.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-content-default">
              <Receipt className="size-8 text-content-subtle" />
              <p className="text-sm">No on-chain jobs yet.</p>
              <Link className="text-primary text-sm underline" href="/">
                Start a new chat
              </Link>
            </div>
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden overflow-auto rounded-2xl border border-bdr-light md:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-bdr-light border-b bg-surface-base-faint text-content-default text-xs">
                      <th className="px-4 py-3 text-left font-medium">When</th>
                      <th className="px-4 py-3 text-left font-medium">Model</th>
                      <th className="px-4 py-3 text-left font-medium">
                        Status
                      </th>
                      <th className="px-4 py-3 text-right font-medium">
                        Cost (LCAI)
                      </th>
                      <th className="px-4 py-3 text-left font-medium">
                        On-chain
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {jobs.map((job) => (
                      <tr
                        className="border-bdr-light border-b last:border-0 hover:bg-surface-base-faint/50"
                        key={job.jobId}
                      >
                        <td className="whitespace-nowrap px-4 py-3 text-content-default">
                          {formatWhen(job.submittedAt)}
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-medium text-content-strong">
                            {job.modelName}
                          </span>
                          <span className="ml-2 font-mono text-[10px] text-content-subtle">
                            job #{job.jobId}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={job.status} />
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right font-medium text-content-strong tabular-nums">
                          {formatLcai(job.feeWei)}
                        </td>
                        <td className="px-4 py-3">
                          <JobLinks job={job} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile cards */}
              <div className="flex flex-col gap-3 md:hidden">
                {jobs.map((job) => (
                  <div
                    className="rounded-xl border border-bdr-light bg-surface-base-faint/40 p-4"
                    key={job.jobId}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-content-strong">
                          {job.modelName}
                        </p>
                        <p className="mt-0.5 text-content-default text-xs">
                          {formatWhen(job.submittedAt)} · job #{job.jobId}
                        </p>
                      </div>
                      <StatusBadge status={job.status} />
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-2">
                      <span className="font-semibold text-content-strong tabular-nums">
                        {formatLcai(job.feeWei)}{" "}
                        <span className="font-normal text-content-default text-xs">
                          LCAI
                        </span>
                      </span>
                    </div>
                    <div className="mt-2">
                      <JobLinks job={job} />
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 py-16 text-center text-content-default">
          <div className="flex size-12 items-center justify-center rounded-full bg-surface-base-faint text-content-soft">
            <Wallet className="size-6" />
          </div>
          <div>
            <p className="font-medium text-content-strong">
              Connect your wallet
            </p>
            <p className="mt-1 max-w-xs text-sm">
              Your jobs and costs are read from the chain for the connected
              address.
            </p>
          </div>
          <ConnectWalletButton />
        </div>
      )}
    </div>
  );
}
