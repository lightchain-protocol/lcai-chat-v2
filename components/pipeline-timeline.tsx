"use client";

import { motion } from "framer-motion";
import { Check, ExternalLink, Loader2, X } from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useAccount } from "wagmi";
import config from "@/config";
import { jobRegistryAbi } from "@/contracts/job-registry-abi";
import {
  jobCompletedEvent,
  jobSubmittedEvent,
  sessionCreatedEvent,
} from "@/contracts/pipeline-events-abi";
import useWeb3Clients from "@/hooks/use-web3-clients";
import { explorerAddressUrl, explorerTxUrl } from "@/lib/explorer";
import type { TrackedJob } from "@/lib/protocol/transport";
import type { ProtocolLoadingStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * A live, verifiable timeline of one prompt's on-chain journey.
 *
 * Ordered pipeline:
 *   Requested → Worker selected → Session ready → Job submitted →
 *   Acknowledged → Generating → Response committed → Settled.
 *
 * Two rules keep the animation honest in real time:
 *  - A step turns green ONLY when its own completion is actually observed for
 *    THIS request — never inferred from how far the loading label has moved.
 *    Every "done" is backed by a chain event, a getJob() read, or, for
 *    Generating, the first token actually rendering. Steps below the current
 *    one stay grey (pending); exactly one step is "active" and shows a loader.
 *  - The authoritative tx hashes and worker address come from the chain (the
 *    submit txHash is discarded by the transport), fetched with getLogs
 *    filtered by the indexed identifiers of this exact request: the session id
 *    and job id created by this send.
 *
 * Scope: the timeline latches onto the un-settled job created by the current
 * send and follows only it, so a previously completed job can never paint the
 * steps green. State resets on each new prompt.
 *
 * Nothing here gates the answer: tokens render as they arrive, and the
 * Response-committed / Settled nodes keep animating in the background after the
 * text is already on screen. Missing evidence leaves a step pending (with the
 * loader if it is the active one) rather than throwing.
 */

const ZERO_HASH =
  "0x0000000000000000000000000000000000000000000000000000000000000000";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const POLL_MS = 2000;

type StepState = "pending" | "active" | "done" | "failed";

type PipelineStep = {
  key: string;
  label: string;
  state: StepState;
  txHash?: string;
  address?: string;
  note?: string;
};

type Evidence = {
  session?: { sessionId: number; worker: string; txHash: string };
  job?: { jobId: number; txHash: string };
  /** getJob() observed state ≥ Acknowledged (or ackTimestamp > 0). */
  acknowledged?: boolean;
  /** getJob() responseBlobHash committed (non-zero). */
  responseCommitted?: boolean;
  completed?: { txHash: string };
};

function truncate(hex?: string): string {
  if (!hex) return "";
  return hex.length > 12 ? `${hex.slice(0, 6)}…${hex.slice(-4)}` : hex;
}

function isZeroHash(v?: string): boolean {
  return !v || v.toLowerCase() === ZERO_HASH;
}

function isZeroAddress(v?: string): boolean {
  return !v || v.toLowerCase() === ZERO_ADDRESS;
}

// Text shown under the one active step, so the wait always says what it is
// waiting for rather than sitting silent.
const ACTIVE_NOTES: Record<string, string> = {
  worker: "finding a worker…",
  session: "opening the session…",
  submitted: "submitting the job…",
  acknowledged: "waiting for the worker…",
  generating: "model is generating…",
  committed: "committing the response…",
  settled: "finalizing on chain…",
};

// biome-ignore lint/nursery/useMaxParams: five flat inputs read clearer here than an options bag for a pure builder.
function buildSteps(
  job: TrackedJob | undefined,
  ev: Evidence,
  firstTokenSeen: boolean,
  isError: boolean,
  activeAllowed: boolean
): { steps: PipelineStep[]; settled: boolean } {
  const worker = isZeroAddress(ev.session?.worker)
    ? isZeroAddress(job?.worker)
      ? undefined
      : job?.worker
    : ev.session?.worker;
  const sessionId = ev.session?.sessionId ?? job?.sessionId;
  const jobId = ev.job?.jobId ?? job?.jobId;
  const sessionTx = ev.session?.txHash;
  const jobTx = ev.job?.txHash;
  const completionTx = ev.completed?.txHash;

  const hasSession = ev.session !== undefined || job !== undefined;
  const hasJob = ev.job !== undefined || job?.jobId !== undefined;
  const acknowledged = ev.acknowledged === true;
  const settled =
    ev.completed !== undefined || (job !== undefined && job.completedAt > 0);
  const committed = ev.responseCommitted === true || settled;

  const defs: Omit<PipelineStep, "state">[] = [
    { key: "requested", label: "Requested", note: "prompt request sent" },
    {
      key: "worker",
      label: "Worker selected",
      address: worker,
      txHash: sessionTx,
    },
    {
      key: "session",
      label: "Session ready",
      txHash: sessionTx,
      note: sessionId !== undefined ? `session #${sessionId}` : undefined,
    },
    {
      key: "submitted",
      label: "Job submitted",
      txHash: jobTx,
      note: jobId !== undefined ? `job #${jobId}` : undefined,
    },
    {
      key: "acknowledged",
      label: "Acknowledged",
      note: acknowledged ? "worker picked up the job" : undefined,
    },
    {
      key: "generating",
      label: "Generating",
      note: firstTokenSeen ? "answer streaming" : undefined,
    },
    {
      key: "committed",
      label: "Response committed",
      txHash: completionTx,
      note: committed ? "blob hash on chain" : undefined,
    },
    {
      key: "settled",
      label: "Settled",
      txHash: completionTx,
      note: settled ? "completion committed on chain" : undefined,
    },
  ];

  // Strict, evidence-only completion — no step turns green from how far the
  // loading label has advanced.
  const done: boolean[] = [
    true, // requested: the send happened (component only renders once in flight)
    !!worker,
    hasSession,
    hasJob,
    acknowledged,
    firstTokenSeen,
    committed,
    settled,
  ];

  // A genuinely-observed later milestone proves the earlier ones (settled ⇒
  // committed ⇒ generated ⇒ …), so backfill in case an in-between read lagged.
  // Safe now that every flag is real evidence, never a label threshold.
  const lastDone = done.lastIndexOf(true);
  for (let i = 0; i < lastDone; i++) done[i] = true;

  let frontierAssigned = false;
  const steps: PipelineStep[] = defs.map((d, i) => {
    let state: StepState;
    if (done[i]) {
      state = "done";
    } else if (frontierAssigned) {
      state = "pending";
    } else {
      frontierAssigned = true;
      state = isError ? "failed" : activeAllowed ? "active" : "pending";
    }
    // The active step always narrates what it is waiting for.
    const note = state === "active" && !d.note ? ACTIVE_NOTES[d.key] : d.note;
    return { ...d, note, state };
  });

  return { steps, settled };
}

function StepIcon({ state }: { state: StepState }) {
  if (state === "done") return <Check size={11} strokeWidth={3} />;
  if (state === "failed") return <X size={11} strokeWidth={3} />;
  if (state === "active") return <Loader2 className="animate-spin" size={11} />;
  return null;
}

function StepRow({
  step,
  isLast,
  explorerBaseUrl,
}: {
  step: PipelineStep;
  isLast: boolean;
  explorerBaseUrl?: string;
}) {
  const active = step.state === "active";
  const showTx = step.state !== "pending" && !isZeroHash(step.txHash);
  const showAddr = step.state !== "pending" && !isZeroAddress(step.address);

  return (
    <li className="flex gap-2.5">
      <div className="flex flex-col items-center">
        <span className="relative flex size-5 shrink-0 items-center justify-center">
          {/* Pulsing halo makes the active step unmistakably "in progress". */}
          {active && (
            <motion.span
              animate={{ opacity: 0, scale: 1.9 }}
              aria-hidden
              className="absolute inset-0 rounded-full bg-gradient-primary"
              initial={{ opacity: 0.5, scale: 1 }}
              transition={{
                duration: 1.4,
                repeat: Number.POSITIVE_INFINITY,
                ease: "easeOut",
              }}
            />
          )}
          <motion.span
            animate={{ scale: 1, opacity: 1 }}
            className={cn(
              "relative flex size-5 items-center justify-center rounded-full border",
              step.state === "done" &&
                "border-emerald-500/60 text-emerald-600 dark:text-emerald-400",
              step.state === "failed" &&
                "border-red-500/60 text-red-600 dark:text-red-400",
              active && "border-transparent bg-gradient-primary text-white",
              step.state === "pending" &&
                "border-border text-content-extraLight"
            )}
            initial={{ scale: 0.6, opacity: 0 }}
            transition={{ duration: 0.25 }}
          >
            <StepIcon state={step.state} />
          </motion.span>
        </span>
        {!isLast && (
          <span
            className={cn(
              "my-0.5 w-px flex-1",
              step.state === "done" ? "bg-emerald-500/40" : "bg-border"
            )}
          />
        )}
      </div>
      <div className="min-w-0 flex-1 pb-3">
        <p
          className={cn(
            "font-medium text-xs leading-5",
            active && "text-content-strong",
            step.state === "done" && "text-content-strong",
            step.state === "failed" && "text-red-600 dark:text-red-400",
            step.state === "pending" && "text-content-extraLight"
          )}
        >
          {step.label}
        </p>
        {(step.note || showAddr || showTx) && (
          <div
            className={cn(
              "mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[10px]",
              active ? "text-content-secondary" : "text-content-subtle"
            )}
          >
            {step.note && (
              <span className={cn(active && "animate-pulse")}>{step.note}</span>
            )}
            {showAddr && (
              <a
                className="inline-flex items-center gap-0.5 text-content-secondary hover:text-content-strong hover:underline"
                href={explorerAddressUrl(
                  step.address as string,
                  explorerBaseUrl
                )}
                rel="noreferrer"
                target="_blank"
              >
                {truncate(step.address)}
                <ExternalLink size={9} />
              </a>
            )}
            {showTx && (
              <a
                className="inline-flex items-center gap-0.5 text-content-secondary hover:text-content-strong hover:underline"
                href={explorerTxUrl(step.txHash as string, explorerBaseUrl)}
                rel="noreferrer"
                target="_blank"
              >
                tx {truncate(step.txHash)}
                <ExternalLink size={9} />
              </a>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

function PurePipelineTimeline({
  progressStatus,
  activeJobs,
  chatId,
  live,
  firstTokenSeen,
  explorerBaseUrl,
}: {
  progressStatus: ProtocolLoadingStatus;
  activeJobs?: TrackedJob[];
  chatId: string;
  /** True while the request is in flight (status submitted/streaming). */
  live: boolean;
  /** True once the answer has actually begun rendering (first token). */
  firstTokenSeen: boolean;
  explorerBaseUrl?: string;
}) {
  const { address } = useAccount();
  const { publicClient } = useWeb3Clients();

  const chainId = config.chains[0].id;
  const registry = config.jobRegistryAddress[chainId];

  // The job THIS send created. We latch onto the newest un-settled job for the
  // chat while live and then follow only it — a previously completed job is
  // never picked up, so the steps can't be painted green by stale events.
  const [currentJobId, setCurrentJobId] = useState<number | null>(null);
  const [evidence, setEvidence] = useState<Evidence>({});
  const fromBlockRef = useRef<bigint | null>(null);
  const prevLiveRef = useRef(false);

  // Each fresh send drops the previous job and clears its evidence + scan window.
  useEffect(() => {
    if (live && !prevLiveRef.current) {
      setCurrentJobId(null);
      setEvidence({});
      fromBlockRef.current = null;
    }
    prevLiveRef.current = live;
  }, [live]);

  // Latch onto the in-flight job once the transport registers it. Only a job
  // that has not completed yet is eligible, so the just-finished prior job is
  // ignored even before its events are filtered out.
  useEffect(() => {
    if (currentJobId !== null || !live) return;
    const fresh = (activeJobs ?? [])
      .filter((j) => j.chatId === chatId && j.completedAt === 0)
      .reduce<TrackedJob | undefined>(
        (a, b) => (a && a.startedAt > b.startedAt ? a : b),
        undefined
      );
    if (fresh) setCurrentJobId(fresh.jobId);
  }, [live, activeJobs, chatId, currentJobId]);

  const job = useMemo(
    () =>
      currentJobId === null
        ? undefined
        : (activeJobs ?? []).find((j) => j.jobId === currentJobId),
    [activeJobs, currentJobId]
  );

  const settled =
    evidence.completed !== undefined ||
    (job !== undefined && job.completedAt > 0);

  // Scan the chain for the authoritative hashes while live, and afterwards
  // until settlement lands (so the last two nodes finish in the background).
  const watching =
    !!publicClient &&
    !!registry &&
    registry !== "0x" &&
    !!address &&
    (live || (!!job && !settled));

  useEffect(() => {
    if (!watching) return;
    let cancelled = false;

    const tick = async () => {
      if (cancelled) return;
      try {
        if (fromBlockRef.current === null) {
          try {
            const bn = await publicClient.getBlockNumber();
            fromBlockRef.current = bn > 5000n ? bn - 5000n : 0n;
          } catch {
            fromBlockRef.current = 0n;
          }
        }
        const fromBlock = fromBlockRef.current ?? 0n;
        const reg = registry as `0x${string}`;

        const sid = evidence.session?.sessionId ?? job?.sessionId;
        const jid = evidence.job?.jobId ?? job?.jobId;

        // Worker + session tx: SessionCreated for THIS user + session id only.
        if (!evidence.session && sid !== undefined && address) {
          const logs = await publicClient.getLogs({
            address: reg,
            event: sessionCreatedEvent,
            args: {
              user: address as `0x${string}`,
              sessionId: BigInt(sid),
            },
            fromBlock,
            toBlock: "latest",
          });
          const match = logs.at(-1);
          if (match && !cancelled) {
            setEvidence((prev) =>
              prev.session
                ? prev
                : {
                    ...prev,
                    session: {
                      sessionId: Number(match.args.sessionId),
                      worker: (match.args.worker as string) ?? "",
                      txHash: match.transactionHash ?? "",
                    },
                  }
            );
          }
        }

        // Job submit tx: JobSubmitted for THIS session id + job id only.
        if (!evidence.job && sid !== undefined && jid !== undefined) {
          const logs = await publicClient.getLogs({
            address: reg,
            event: jobSubmittedEvent,
            args: { sessionId: BigInt(sid), jobId: BigInt(jid) },
            fromBlock,
            toBlock: "latest",
          });
          const match = logs.at(-1);
          if (match && !cancelled) {
            setEvidence((prev) =>
              prev.job
                ? prev
                : {
                    ...prev,
                    job: {
                      jobId: Number(match.args.jobId),
                      txHash: match.transactionHash ?? "",
                    },
                  }
            );
          }
        }

        if (jid !== undefined) {
          // Ack + response-blob commitment, straight from the job record.
          try {
            const j = (await publicClient.readContract({
              address: reg,
              abi: jobRegistryAbi,
              functionName: "getJob",
              args: [BigInt(jid)],
            })) as {
              state: number;
              ackTimestamp: bigint;
              responseBlobHash: string;
            };
            if (!cancelled) {
              const ack = Number(j.state) >= 1 || Number(j.ackTimestamp) > 0;
              const committed = !isZeroHash(j.responseBlobHash);
              setEvidence((prev) => {
                if (
                  prev.acknowledged === ack &&
                  prev.responseCommitted === committed
                ) {
                  return prev;
                }
                return {
                  ...prev,
                  acknowledged: prev.acknowledged || ack,
                  responseCommitted: prev.responseCommitted || committed,
                };
              });
            }
          } catch {
            // read failed — leave those steps as they are, retry next tick.
          }

          // Settlement tx: JobCompleted for THIS job id only.
          if (!evidence.completed) {
            const logs = await publicClient.getLogs({
              address: reg,
              event: jobCompletedEvent,
              args: { jobId: BigInt(jid) },
              fromBlock,
              toBlock: "latest",
            });
            const match = logs.at(-1);
            if (match && !cancelled) {
              setEvidence((prev) =>
                prev.completed
                  ? prev
                  : {
                      ...prev,
                      completed: { txHash: match.transactionHash ?? "" },
                    }
              );
            }
          }
        }
      } catch {
        // Any RPC hiccup: skip this tick, steps stay where they are.
      }
    };

    tick();
    const interval = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // sid/jid are derived from job + evidence, already in the dep list.
  }, [watching, publicClient, registry, address, job, evidence]);

  const isError = progressStatus === "error";
  const activeAllowed = live || (!!job && !settled);

  const { steps, settled: builtSettled } = buildSteps(
    job,
    evidence,
    firstTokenSeen,
    isError,
    activeAllowed
  );

  // Show while in flight; after the answer is on screen, linger only until
  // settlement lands (Response-committed / Settled finish animating), then the
  // per-message provenance panel takes over.
  const visible = live || (!!job && !builtSettled);
  if (!visible) return null;
  if (progressStatus === "idle" && !job && !live) return null;

  return (
    <div
      className="rounded-xl border border-border bg-surface-base-faint/40 p-3"
      data-testid="pipeline-timeline"
    >
      <div className="mb-2 flex items-center gap-2">
        <span className="font-medium text-[11px] text-content-strong uppercase tracking-[0.08em]">
          On-chain pipeline
        </span>
        <span className="text-[10px] text-content-subtle">
          each step verifiable on the explorer
        </span>
      </div>
      <ol className="flex flex-col">
        {steps.map((step, i) => (
          <StepRow
            explorerBaseUrl={explorerBaseUrl}
            isLast={i === steps.length - 1}
            key={step.key}
            step={step}
          />
        ))}
      </ol>
    </div>
  );
}

export const PipelineTimeline = memo(PurePipelineTimeline);
