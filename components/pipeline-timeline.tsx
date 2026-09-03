"use client";

import { motion } from "framer-motion";
import { Check, ChevronDown, ExternalLink, X } from "lucide-react";
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
import { isSettledJobState } from "@/lib/protocol/job-state";
import type { TrackedJob } from "@/lib/protocol/transport";
import type { ProtocolLoadingStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Shimmer } from "./ai-elements/shimmer";
import { LCAIIcon } from "./icons";

/**
 * A live, verifiable timeline of one prompt's on-chain journey.
 *
 * Ordered pipeline:
 *   Requested → Worker selected → Session ready → Job submitted →
 *   Acknowledged → Generating → Response committed → Completed → Settled.
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
 * Scope: the timeline latches onto the unfinished job created by the current
 * send and follows only it, so a previously completed job can never paint the
 * steps green. State resets on each new prompt.
 *
 * Nothing here gates the answer: tokens render as they arrive, and the
 * Response-committed / Completed / Settled nodes keep animating in the
 * background after the text is already on screen. Missing evidence leaves a
 * step pending rather than throwing.
 *
 * Presentation (two lifecycle states, one mounted instance so evidence never
 * resets mid-turn):
 *  - Before the answer streams, it stands in for the plain "thinking" bubble as
 *    a compact panel attached to the assistant message.
 *  - Once the answer is on screen it collapses to a slim, inline one-line
 *    provenance handle on that message ("Completing on-chain…" → "Completed
 *    on-chain"), expandable to the full step list — so it never reads as
 *    though the answer itself is still loading.
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
  /** getJob() state. Settled once it reads Resolved (5) or Released (6). */
  jobState?: number;
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
  worker: "finding a worker",
  session: "opening the session",
  submitted: "submitting the job",
  acknowledged: "waiting for the worker",
  generating: "model is generating",
  committed: "committing the response",
  completed: "finalizing on chain",
};

// biome-ignore lint/nursery/useMaxParams: five flat inputs read clearer here than an options bag for a pure builder.
function buildSteps(
  job: TrackedJob | undefined,
  ev: Evidence,
  firstTokenSeen: boolean,
  isError: boolean,
  activeAllowed: boolean
): { steps: PipelineStep[]; completed: boolean } {
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
  const completed =
    ev.completed !== undefined || (job !== undefined && job.completedAt > 0);
  const committed = ev.responseCommitted === true || completed;
  const settled = ev.jobState !== undefined && isSettledJobState(ev.jobState);

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
      key: "completed",
      label: "Completed",
      txHash: completionTx,
      note: completed ? "completion committed on chain" : undefined,
    },
    {
      key: "settled",
      label: "Settled",
      note: settled
        ? "fee finalized on chain"
        : completed
          ? "awaiting the dispute window"
          : undefined,
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
    completed,
    settled,
  ];

  // A genuinely-observed later milestone proves the earlier ones (completed ⇒
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

  return { steps, completed };
}

/** Small, restrained node: hollow ring pending, gentle accent pulse active,
 *  muted-green check done. No halo, no gradient fill. */
function StepNode({ state }: { state: StepState }) {
  if (state === "active") {
    return (
      <span className="relative flex size-[18px] shrink-0 items-center justify-center">
        <motion.span
          animate={{ opacity: [1, 0.4, 1] }}
          className="flex size-[18px] items-center justify-center rounded-full border-[1.5px] border-primary/60"
          transition={{
            duration: 1.5,
            repeat: Number.POSITIVE_INFINITY,
            ease: "easeInOut",
          }}
        >
          <span className="size-[5px] rounded-full bg-primary" />
        </motion.span>
      </span>
    );
  }
  return (
    <span
      className={cn(
        "flex size-[18px] shrink-0 items-center justify-center rounded-full border transition-colors",
        state === "done" &&
          "border-emerald-600/30 bg-emerald-500/10 text-emerald-600 dark:border-emerald-400/25 dark:text-emerald-400",
        state === "failed" &&
          "border-red-500/50 text-red-600 dark:text-red-400",
        state === "pending" && "border-[1.5px] border-border"
      )}
    >
      {state === "done" && <Check size={10} strokeWidth={3} />}
      {state === "failed" && <X size={10} strokeWidth={3} />}
    </span>
  );
}

function ExplorerLink({
  href,
  children,
  title,
}: {
  href: string;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <a
      className="inline-flex max-w-full items-center gap-0.5 rounded-sm text-content-secondary transition-colors hover:text-content-strong hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      href={href}
      rel="noreferrer noopener"
      target="_blank"
      title={title}
    >
      {children}
      <ExternalLink className="shrink-0" size={9} />
    </a>
  );
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
        <StepNode state={step.state} />
        {!isLast && (
          <span
            className={cn(
              "my-1 w-px flex-1",
              step.state === "done" ? "bg-emerald-500/30" : "bg-border"
            )}
          />
        )}
      </div>
      <div className="min-w-0 flex-1 pb-2.5">
        <p
          className={cn(
            "font-medium text-xs leading-[18px]",
            active && "text-content-strong",
            step.state === "done" && "text-content-strong",
            step.state === "failed" && "text-red-600 dark:text-red-400",
            step.state === "pending" && "text-content-extraLight"
          )}
        >
          {step.label}
        </p>
        {(step.note || showAddr || showTx) && (
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[10px] text-content-secondary">
            {step.note &&
              (active ? (
                // Barely-there shimmer on the "what it's waiting for" line.
                <Shimmer as="span" className="text-[10px]" duration={2.2}>
                  {step.note}
                </Shimmer>
              ) : (
                <span className="text-content-subtle">{step.note}</span>
              ))}
            {showAddr && (
              <ExplorerLink
                href={explorerAddressUrl(
                  step.address as string,
                  explorerBaseUrl
                )}
                title={step.address}
              >
                {truncate(step.address)}
              </ExplorerLink>
            )}
            {showTx && (
              <ExplorerLink
                href={explorerTxUrl(step.txHash as string, explorerBaseUrl)}
                title={step.txHash}
              >
                tx {truncate(step.txHash)}
              </ExplorerLink>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

function StepList({
  steps,
  explorerBaseUrl,
}: {
  steps: PipelineStep[];
  explorerBaseUrl?: string;
}) {
  return (
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
  );
}

/** Soft, low-amplitude animated ellipsis for the collapsed "completing" line. */
function Ellipsis() {
  return (
    <span aria-hidden className="inline-flex">
      {[0, 1, 2].map((i) => (
        <motion.span
          animate={{ opacity: [0.25, 1, 0.25] }}
          key={i}
          transition={{
            duration: 1.4,
            repeat: Number.POSITIVE_INFINITY,
            ease: "easeInOut",
            delay: i * 0.18,
          }}
        >
          .
        </motion.span>
      ))}
    </span>
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

  // The job THIS send created. We latch onto the newest unfinished job for the
  // chat while live and then follow only it — a previously completed job is
  // never picked up, so the steps can't be painted green by stale events.
  const [currentJobId, setCurrentJobId] = useState<number | null>(null);
  const [evidence, setEvidence] = useState<Evidence>({});
  // The collapsed handle stays collapsed by default; the user opens it.
  const [expanded, setExpanded] = useState(false);
  const fromBlockRef = useRef<bigint | null>(null);
  const prevLiveRef = useRef(false);

  // Each fresh send drops the previous job and clears its evidence + scan window.
  useEffect(() => {
    if (live && !prevLiveRef.current) {
      setCurrentJobId(null);
      setEvidence({});
      setExpanded(false);
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

  // The poll reads the latest job/evidence through refs so that a new evidence
  // object — set by the poll itself — does not tear the interval down and
  // refire the tick. The effect re-arms only when what it watches changes.
  const jobRef = useRef(job);
  jobRef.current = job;
  const evidenceRef = useRef(evidence);
  evidenceRef.current = evidence;

  const completed =
    evidence.completed !== undefined ||
    (job !== undefined && job.completedAt > 0);

  // Scan the chain for the authoritative hashes while live, and afterwards
  // until completion lands (so the last two nodes finish in the background).
  const watching =
    !!publicClient &&
    !!registry &&
    registry !== "0x" &&
    !!address &&
    (live || (!!job && !completed));

  useEffect(() => {
    if (!watching) return;
    let cancelled = false;

    const tick = async () => {
      // biome-ignore lint/nursery/noShadow: reads the latest value through the ref under the outer name, see the ref comment above.
      const job = jobRef.current;
      // biome-ignore lint/nursery/noShadow: same as above, for evidence.
      const evidence = evidenceRef.current;
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
              const state = Number(j.state);
              setEvidence((prev) => {
                if (
                  prev.acknowledged === ack &&
                  prev.responseCommitted === committed &&
                  prev.jobState === state
                ) {
                  return prev;
                }
                return {
                  ...prev,
                  acknowledged: prev.acknowledged || ack,
                  responseCommitted: prev.responseCommitted || committed,
                  jobState: state,
                };
              });
            }
          } catch {
            // read failed — leave those steps as they are, retry next tick.
          }

          // Completion tx: JobCompleted for THIS job id only.
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
  }, [watching, publicClient, registry, address]);

  const isError = progressStatus === "error";
  const activeAllowed = live || (!!job && !completed);

  const { steps, completed: builtCompleted } = buildSteps(
    job,
    evidence,
    firstTokenSeen,
    isError,
    activeAllowed
  );

  // Nothing worth attaching yet: no live request, no tracked job, no answer.
  if (!(live || job || firstTokenSeen)) return null;
  if (progressStatus === "idle" && !job && !live) return null;

  // ── Thinking state ────────────────────────────────────────────────────────
  // Before a single token is on screen the timeline stands in for the plain
  // "thinking" bubble: attached to the assistant message, a compact panel.
  if (!firstTokenSeen) {
    return (
      <motion.div
        animate={{ opacity: 1 }}
        className="group/message w-full"
        data-role="assistant"
        data-testid="pipeline-timeline"
        initial={{ opacity: 0 }}
      >
        <div className="flex items-start gap-2 md:gap-3">
          <div className="-mt-1 flex size-8 shrink-0 items-center justify-center rounded-full bg-background p-1 ring-1 ring-border">
            <LCAIIcon size={14} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="rounded-xl border border-border bg-surface-base-faint/50 px-3 py-2.5 shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
              <div className="mb-2.5 flex items-baseline justify-between gap-2">
                <span className="font-medium text-[11px] text-content-strong uppercase tracking-[0.08em]">
                  On-chain pipeline
                </span>
                <span className="truncate text-[10px] text-content-subtle">
                  verifiable on the explorer
                </span>
              </div>
              <StepList explorerBaseUrl={explorerBaseUrl} steps={steps} />
            </div>
          </div>
        </div>
      </motion.div>
    );
  }

  // ── Collapsed provenance handle ───────────────────────────────────────────
  // The answer is on screen; shrink to a slim inline line on the message. It
  // reads as completion progress, never as "the answer is still loading".
  const failed = isError;
  const activeStep = steps.find((s) => s.state === "active");

  let label: React.ReactNode;
  if (failed) {
    label = "Failed on-chain";
  } else if (builtCompleted) {
    label = "Completed on-chain";
  } else {
    label = (
      <span className="inline-flex items-baseline">
        <span>Completing on-chain</span>
        <Ellipsis />
      </span>
    );
  }

  return (
    <div
      className="w-full pl-10 md:pl-11"
      data-completed={builtCompleted ? "true" : "false"}
      data-testid="pipeline-timeline"
    >
      <button
        aria-expanded={expanded}
        className={cn(
          "flex w-full max-w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs transition-colors hover:bg-surface-base-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
          builtCompleted && "text-emerald-600 dark:text-emerald-400",
          failed && "text-red-600 dark:text-red-400",
          !(builtCompleted || failed) && "text-content-secondary"
        )}
        onClick={() => setExpanded((v) => !v)}
        type="button"
      >
        {builtCompleted ? (
          <span className="flex size-3.5 shrink-0 items-center justify-center rounded-full border border-emerald-600/30 bg-emerald-500/10">
            <Check size={9} strokeWidth={3} />
          </span>
        ) : failed ? (
          <X className="shrink-0" size={13} />
        ) : (
          <motion.span
            animate={{ opacity: [1, 0.4, 1] }}
            className="size-2 shrink-0 rounded-full border-[1.5px] border-primary/60"
            transition={{
              duration: 1.5,
              repeat: Number.POSITIVE_INFINITY,
              ease: "easeInOut",
            }}
          />
        )}
        <span className="truncate font-medium">{label}</span>
        {!(builtCompleted || failed) && activeStep?.note && (
          <span className="hidden truncate font-mono text-[11px] text-content-subtle sm:inline">
            · {activeStep.note}
          </span>
        )}
        <ChevronDown
          className={cn(
            "ml-auto shrink-0 text-content-subtle transition-transform",
            expanded && "rotate-180"
          )}
          size={13}
        />
      </button>

      {expanded && (
        <motion.div
          animate={{ height: "auto", opacity: 1 }}
          className="overflow-hidden"
          initial={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
        >
          <div className="mt-1.5 rounded-lg border border-border bg-surface-base-faint/40 px-3 py-2.5">
            <StepList explorerBaseUrl={explorerBaseUrl} steps={steps} />
          </div>
        </motion.div>
      )}
    </div>
  );
}

export const PipelineTimeline = memo(PurePipelineTimeline);
