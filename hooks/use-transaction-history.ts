"use client";

import { useMemo } from "react";
import useSWR from "swr";
import type { PublicClient } from "viem";
import { useAccount } from "wagmi";
import config from "@/config";
import { aiConfigAbi } from "@/contracts/ai-config-abi";
import { jobRegistryAbi } from "@/contracts/job-registry-abi";
import {
  jobCompletedEvent,
  jobSubmittedEvent,
  sessionCreatedEvent,
} from "@/contracts/pipeline-events-abi";
import { useModels } from "@/hooks/use-models";
import useWeb3Clients from "@/hooks/use-web3-clients";
import { isCompletedJobState } from "@/lib/protocol/job-state";

/**
 * The connected wallet's on-chain AI jobs, read directly from the JobRegistry —
 * no backend, no indexer. This is the "verifiable product" surface: every field
 * comes from a chain event or a `getJob()` read, and every row links out to the
 * block explorer so the user can check the claim themselves.
 *
 * Assembly (all client-side, via the app's viem public client):
 *   1. `SessionCreated(user, …)` filtered by the connected address → each
 *      session's id, modelId, worker and creation tx.
 *   2. `JobSubmitted(sessionId, …)` for those sessions → the job id + submit tx.
 *   3. `getJob(jobId)` → authoritative state, escrowed fee, and timestamps.
 *   4. `JobCompleted(jobId, …)` → the settlement tx.
 * The per-model fee (`AIConfig.calculateJobFee` — the same flat fee the job is
 * actually charged) backstops a row whose on-chain escrow reads as 0, so the
 * cost shown is always the real amount, never a fabricated one.
 *
 * Resilience (same failure mode as use-worker-counts): the public RPC pool can
 * intermittently answer a `getLogs` from a node with incomplete state, dropping
 * jobs from a single read. Two guards keep the panel honest:
 *   - a wide-range `getLogs` is retried in capped windows when the provider
 *     rejects the range, and any window that errors is skipped rather than
 *     aborting the scan;
 *   - a session-scoped cache unions every job ever seen for the address, so a
 *     transient short read never blanks or shrinks a list the user already saw.
 * A job's mutable fields (state, fee, completion) are always taken from the
 * freshest successful read, so statuses still advance.
 */

export type JobStatus = "pending" | "completed" | "failed";

export type TransactionJob = {
  jobId: string;
  sessionId: string;
  /** bytes32 model id, lower-cased for name lookup. */
  modelId: string;
  modelName: string;
  worker: string | null;
  status: JobStatus;
  /** Cost in wei (18-decimal LCAI) — the escrowed fee, or the model fee. */
  feeWei: bigint;
  /** Unix seconds of submission, for display + ordering. */
  submittedAt: number;
  completedAt: number;
  sessionTxHash: string | null;
  submitTxHash: string | null;
  completionTxHash: string | null;
};

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

// Most recent jobs to hydrate with per-job reads — bounds RPC fan-out on a
// long-lived wallet while still covering a generous history.
const MAX_JOBS = 60;

// Session-scoped union of every job seen for an address, so a flaky short read
// never drops rows the user already has. Keyed by `${chainId}:${address}`.
const seenJobs = new Map<string, Map<string, TransactionJob>>();

type EventParams = Parameters<PublicClient["getLogs"]>[0];

/**
 * `getLogs` that prefers one whole-chain scan and, only when the provider caps
 * the range, walks backward in capped windows — skipping any window that
 * errors rather than losing the whole read.
 */
async function getLogsResilient(
  client: PublicClient,
  params: EventParams,
  latest: bigint
): Promise<Awaited<ReturnType<PublicClient["getLogs"]>>> {
  try {
    return await client.getLogs({
      ...params,
      fromBlock: 0n,
      toBlock: latest,
    } as EventParams);
  } catch {
    const CHUNK = 9000n;
    const MAX_WINDOWS = 30; // ≈270k blocks of lookback in the fallback path
    const out: Awaited<ReturnType<PublicClient["getLogs"]>> = [];
    let to = latest;
    for (let i = 0; i < MAX_WINDOWS && to > 0n; i++) {
      const from = to > CHUNK ? to - CHUNK : 0n;
      try {
        const logs = await client.getLogs({
          ...params,
          fromBlock: from,
          toBlock: to,
        } as EventParams);
        out.push(...(logs as typeof out));
      } catch {
        // Skip this window; a bad node on one range must not abort the scan.
      }
      if (from === 0n) break;
      to = from - 1n;
    }
    return out;
  }
}

function classifyStatus(state: number): JobStatus {
  if (isCompletedJobState(state)) return "completed";
  if (state === 3) return "failed"; // TimedOut
  return "pending"; // Submitted / Acknowledged / Disputed
}

export function useTransactionHistory(): {
  jobs: TransactionJob[];
  totalSpentWei: bigint;
  isLoading: boolean;
  error: unknown;
  refresh: () => void;
} {
  const { address } = useAccount();
  const { publicClient } = useWeb3Clients();
  const { models } = useModels();

  const chainId = config.chains[0].id;
  const registryAddress = config.jobRegistryAddress[chainId];
  const aiConfigAddress = config.aiConfigAddress[chainId];

  const modelNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of models) map.set(m.id.toLowerCase(), m.name);
    return map;
  }, [models]);

  const enabled =
    !!address &&
    !!publicClient &&
    !!registryAddress &&
    registryAddress !== "0x";

  const swrKey = enabled
    ? `tx-history:${chainId}:${registryAddress}:${address}`
    : null;

  const { data, error, isLoading, mutate } = useSWR(
    swrKey,
    async () => {
      const client = publicClient as PublicClient;
      const reg = registryAddress as `0x${string}`;
      const user = address as `0x${string}`;

      const latest = await client.getBlockNumber();

      // 1. The user's sessions.
      const sessionLogs = await getLogsResilient(
        client,
        {
          address: reg,
          event: sessionCreatedEvent,
          args: { user },
        } as EventParams,
        latest
      );

      const sessions = new Map<
        string,
        { modelId: string; worker: string | null; txHash: string | null }
      >();
      for (const log of sessionLogs) {
        const a = (log as { args: Record<string, unknown> }).args;
        const sid = String(a.sessionId as bigint);
        const worker = a.worker as string | undefined;
        sessions.set(sid, {
          modelId: (a.modelId as string).toLowerCase(),
          worker: worker && worker !== ZERO_ADDRESS ? worker : null,
          txHash: (log as { transactionHash?: string }).transactionHash ?? null,
        });
      }

      // 2. Jobs submitted under those sessions.
      const sessionIds = [...sessions.keys()];
      const submits: {
        jobId: string;
        sessionId: string;
        txHash: string | null;
      }[] = [];
      if (sessionIds.length > 0) {
        const jobLogs = await getLogsResilient(
          client,
          {
            address: reg,
            event: jobSubmittedEvent,
            args: { sessionId: sessionIds.map((s) => BigInt(s)) },
          } as EventParams,
          latest
        );
        for (const log of jobLogs) {
          const a = (log as { args: Record<string, unknown> }).args;
          submits.push({
            jobId: String(a.jobId as bigint),
            sessionId: String(a.sessionId as bigint),
            txHash:
              (log as { transactionHash?: string }).transactionHash ?? null,
          });
        }
      }

      // Newest first, then bound the per-job read fan-out.
      submits.sort((x, y) => Number(BigInt(y.jobId) - BigInt(x.jobId)));
      const recent = submits.slice(0, MAX_JOBS);

      // 3 + 4. Per-job record, completion tx, and the model fee fallback.
      const feeCache = new Map<string, bigint>();
      const readModelFee = async (modelId: string): Promise<bigint> => {
        const cached = feeCache.get(modelId);
        if (cached !== undefined) return cached;
        try {
          const fee = (await client.readContract({
            address: aiConfigAddress as `0x${string}`,
            abi: aiConfigAbi,
            functionName: "calculateJobFee",
            args: [modelId as `0x${string}`],
          })) as bigint;
          feeCache.set(modelId, fee);
          return fee;
        } catch {
          feeCache.set(modelId, 0n);
          return 0n;
        }
      };

      const rows = await Promise.all(
        recent.map(async (s): Promise<TransactionJob | null> => {
          const session = sessions.get(s.sessionId);
          const modelId = session?.modelId ?? "";

          let state = 0;
          let escrowedFee = 0n;
          let submittedAt = 0;
          let completedAt = 0;
          let jobWorker: string | null = session?.worker ?? null;
          try {
            const job = (await client.readContract({
              address: reg,
              abi: jobRegistryAbi,
              functionName: "getJob",
              args: [BigInt(s.jobId)],
            })) as {
              worker: string;
              state: number;
              escrowedFee: bigint;
              submittedAt: bigint;
              completedAt: bigint;
            };
            state = Number(job.state);
            escrowedFee = job.escrowedFee;
            submittedAt = Number(job.submittedAt);
            completedAt = Number(job.completedAt);
            if (job.worker && job.worker !== ZERO_ADDRESS) {
              jobWorker = job.worker;
            }
          } catch {
            // getJob failed on a flaky node — the cache union below keeps any
            // previously-hydrated version of this row rather than losing it.
            return null;
          }

          const status = classifyStatus(state);

          let completionTxHash: string | null = null;
          if (status === "completed") {
            try {
              const doneLogs = await getLogsResilient(
                client,
                {
                  address: reg,
                  event: jobCompletedEvent,
                  args: { jobId: BigInt(s.jobId) },
                } as EventParams,
                latest
              );
              const match = doneLogs.at(-1) as
                | { transactionHash?: string }
                | undefined;
              completionTxHash = match?.transactionHash ?? null;
            } catch {
              completionTxHash = null;
            }
          }

          const feeWei =
            escrowedFee > 0n ? escrowedFee : await readModelFee(modelId);

          return {
            jobId: s.jobId,
            sessionId: s.sessionId,
            modelId,
            modelName: modelNameById.get(modelId) ?? "Unknown model",
            worker: jobWorker,
            status,
            feeWei,
            submittedAt,
            completedAt,
            sessionTxHash: session?.txHash ?? null,
            submitTxHash: s.txHash,
            completionTxHash,
          };
        })
      );

      // Union into the session cache: refresh known jobs, keep ones a flaky
      // read dropped, and never shrink the list the user already saw.
      const cacheKey = `${chainId}:${address}`;
      const store = seenJobs.get(cacheKey) ?? new Map<string, TransactionJob>();
      for (const row of rows) {
        if (row) store.set(row.jobId, row);
      }
      seenJobs.set(cacheKey, store);

      const merged = [...store.values()].sort((a, b) => {
        const at = a.submittedAt || 0;
        const bt = b.submittedAt || 0;
        if (bt !== at) return bt - at;
        return Number(BigInt(b.jobId) - BigInt(a.jobId));
      });

      return merged;
    },
    {
      revalidateOnFocus: false,
      keepPreviousData: true,
      // Statuses (pending → completed) advance without hammering the RPC.
      refreshInterval: 30_000,
    }
  );

  const jobs = data ?? [];
  const totalSpentWei = useMemo(
    () => jobs.reduce((sum, j) => sum + j.feeWei, 0n),
    [jobs]
  );

  return {
    jobs,
    totalSpentWei,
    isLoading,
    error,
    refresh: () => {
      mutate();
    },
  };
}
