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
 * Replaces the single "Finding a worker…" line with the ordered pipeline:
 *   Requested → Worker selected → Session ready → Job submitted →
 *   Acknowledged → Generating → Response committed → Settled.
 *
 * Two sources are reconciled:
 *  - State transitions (pending → active → done) come from the relay-driven
 *    `progressStatus` and the transport's tracked job — the same signals that
 *    already move the chat, so the animation matches reality with no lag.
 *  - The authoritative tx hashes and worker address come from the chain: the
 *    submit txHash is discarded by the transport, so the only trustworthy
 *    source is the events themselves, fetched with getLogs filtered by the
 *    identifiers this client already knows (user address → SessionCreated,
 *    sessionId → JobSubmitted, jobId → JobCompleted).
 *
 * Every hash/address is a link to the block explorer, so a user can verify
 * each step independently. Nothing here gates the visible answer: tokens
 * render as they arrive, and the Response-committed / Settled nodes keep
 * animating in the background after the text is already on screen.
 *
 * Degrades gracefully: if an event is never seen (or an RPC read fails) the
 * step simply stays pending — the component never throws.
 */

const ZERO_HASH =
  "0x0000000000000000000000000000000000000000000000000000000000000000";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

// How far the relay-driven loading status has advanced, so a step without a
// dedicated on-chain event (Requested, Acknowledged, Generating) can still
// animate honestly from the signal the chat already trusts.
const PROGRESS_ORDER: Record<ProtocolLoadingStatus, number> = {
  idle: 0,
  finding_worker: 1,
  preparing_chat: 2,
  writing_on_chain: 3,
  submitting_job: 4,
  waiting_for_relay: 5,
  decoding_prompt: 6,
  thinking: 6,
  reasoning: 7,
  streaming: 7,
  completed: 8,
  error: -1,
};

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

function buildSteps(
  progressStatus: ProtocolLoadingStatus,
  job: TrackedJob | undefined,
  ev: Evidence,
  activeAllowed: boolean
): { steps: PipelineStep[]; settled: boolean } {
  const p = PROGRESS_ORDER[progressStatus] ?? 0;
  const isError = progressStatus === "error";

  const sessionId = ev.session?.sessionId ?? job?.sessionId;
  const worker = isZeroAddress(ev.session?.worker)
    ? isZeroAddress(job?.worker)
      ? undefined
      : job?.worker
    : ev.session?.worker;
  const jobId = ev.job?.jobId ?? job?.jobId;
  const sessionTx = ev.session?.txHash;
  const jobTx = ev.job?.txHash;
  const completionTx = ev.completed?.txHash;

  const settled =
    ev.completed !== undefined ||
    (job !== undefined && job.completedAt > 0) ||
    progressStatus === "completed";
  const responseCommitted = ev.responseCommitted === true || settled;
  const acknowledged =
    ev.acknowledged === true || p >= PROGRESS_ORDER.waiting_for_relay;
  const generating = responseCommitted || p >= PROGRESS_ORDER.decoding_prompt;

  const defs: Omit<PipelineStep, "state">[] = [
    {
      key: "requested",
      label: "Requested",
      note: "prompt request accepted",
    },
    {
      key: "worker",
      label: "Worker selected",
      address: worker,
      txHash: sessionTx,
      note: worker ? undefined : "sortition in progress",
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
      note: generating ? "answer streaming" : undefined,
    },
    {
      key: "committed",
      label: "Response committed",
      txHash: completionTx,
      note: responseCommitted ? "blob hash on chain" : undefined,
    },
    {
      key: "settled",
      label: "Settled",
      txHash: completionTx,
      note: settled ? "completion committed on chain" : undefined,
    },
  ];

  const done: boolean[] = [
    sessionId !== undefined || p >= PROGRESS_ORDER.preparing_chat || !!job,
    !!worker,
    ev.session !== undefined ||
      jobId !== undefined ||
      p >= PROGRESS_ORDER.thinking,
    jobId !== undefined,
    acknowledged,
    settled || responseCommitted || p >= PROGRESS_ORDER.reasoning,
    responseCommitted,
    settled,
  ];

  // Evidence of a later milestone proves every earlier one, even if a read for
  // an in-between step happened to fail — backfill so the cascade stays honest.
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
    return { ...d, state };
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
  const showTx = step.state !== "pending" && !isZeroHash(step.txHash);
  const showAddr = step.state !== "pending" && !isZeroAddress(step.address);

  return (
    <li className="flex gap-2.5">
      <div className="flex flex-col items-center">
        <motion.span
          animate={{ scale: 1, opacity: 1 }}
          className={cn(
            "flex size-5 shrink-0 items-center justify-center rounded-full border",
            step.state === "done" &&
              "border-emerald-500/60 text-emerald-600 dark:text-emerald-400",
            step.state === "failed" &&
              "border-red-500/60 text-red-600 dark:text-red-400",
            step.state === "active" &&
              "border-transparent bg-gradient-primary text-white",
            step.state === "pending" && "border-border text-content-extraLight"
          )}
          initial={{ scale: 0.6, opacity: 0 }}
          transition={{ duration: 0.25 }}
        >
          <StepIcon state={step.state} />
        </motion.span>
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
            step.state === "pending"
              ? "text-content-extraLight"
              : "text-content-strong"
          )}
        >
          {step.label}
        </p>
        {(step.note || showAddr || showTx) && (
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[10px] text-content-subtle">
            {step.note && <span>{step.note}</span>}
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
  explorerBaseUrl,
}: {
  progressStatus: ProtocolLoadingStatus;
  activeJobs?: TrackedJob[];
  chatId: string;
  /** True while the request is in flight (status submitted/streaming). */
  live: boolean;
  explorerBaseUrl?: string;
}) {
  const { address } = useAccount();
  const { publicClient } = useWeb3Clients();

  const chainId = config.chains[0].id;
  const registry = config.jobRegistryAddress[chainId];

  // The job this timeline is following: the most recently started one for
  // this chat (the transport tracks one per active send).
  const job = useMemo(() => {
    const mine = (activeJobs ?? []).filter((j) => j.chatId === chatId);
    if (mine.length === 0) return;
    return mine.reduce((a, b) => (b.startedAt > a.startedAt ? b : a));
  }, [activeJobs, chatId]);

  const [evidence, setEvidence] = useState<Evidence>({});
  const fromBlockRef = useRef<bigint | null>(null);
  const prevLiveRef = useRef(false);

  // A fresh send resets the evidence and the log-scan window.
  useEffect(() => {
    if (live && !prevLiveRef.current) {
      setEvidence({});
      fromBlockRef.current = null;
    }
    prevLiveRef.current = live;
  }, [live]);

  const settled =
    evidence.completed !== undefined ||
    (job !== undefined && job.completedAt > 0);

  // Keep scanning the chain for the authoritative hashes while the request is
  // live, and afterwards until settlement lands — so the Response-committed /
  // Settled nodes finish in the background once the text is already visible.
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
            // A small lookback catches events that fired just before mount.
            fromBlockRef.current = bn > 5000n ? bn - 5000n : 0n;
          } catch {
            fromBlockRef.current = 0n;
          }
        }
        const fromBlock = fromBlockRef.current ?? 0n;
        const reg = registry as `0x${string}`;

        // Worker + session tx: SessionCreated indexed by this user.
        if (!evidence.session && address) {
          const logs = await publicClient.getLogs({
            address: reg,
            event: sessionCreatedEvent,
            args: { user: address as `0x${string}` },
            fromBlock,
            toBlock: "latest",
          });
          const known = job?.sessionId;
          const match =
            (known !== undefined
              ? logs.find((l) => Number(l.args.sessionId) === known)
              : undefined) ?? logs.at(-1);
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

        const sid = evidence.session?.sessionId ?? job?.sessionId;

        // Job submit tx: JobSubmitted indexed by sessionId.
        if (sid !== undefined && !evidence.job) {
          const logs = await publicClient.getLogs({
            address: reg,
            event: jobSubmittedEvent,
            args: { sessionId: BigInt(sid) },
            fromBlock,
            toBlock: "latest",
          });
          const known = job?.jobId;
          const match =
            (known !== undefined
              ? logs.find((l) => Number(l.args.jobId) === known)
              : undefined) ?? logs.at(-1);
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

        const jid = evidence.job?.jobId ?? job?.jobId;
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
            // read failed — leave those steps pending, try again next tick.
          }

          // Settlement tx: JobCompleted indexed by jobId.
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
    const interval = setInterval(tick, 2500);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // jobId/sessionId are derived from job + evidence, already listed here.
  }, [watching, publicClient, registry, address, job, evidence]);

  const activeAllowed =
    live || (!!job && !settled) || (PROGRESS_ORDER[progressStatus] ?? 0) > 0;

  const { steps, settled: builtSettled } = buildSteps(
    progressStatus,
    job,
    evidence,
    activeAllowed
  );

  // Nothing to show before a request starts. While live, always shown; after
  // the answer is on screen the timeline lingers only until settlement lands
  // (so the Response-committed / Settled nodes finish animating), then the
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
