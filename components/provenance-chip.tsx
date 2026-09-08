"use client";

import { motion } from "framer-motion";
import {
  ChevronDown,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
} from "lucide-react";
import { memo, useEffect, useState } from "react";
import { toast } from "sonner";
import type { Address } from "viem";
import type { GenerationStats } from "@/lib/protocol/relay-client";
import {
  isAvoided,
  isPinned,
  readWorkerPreference,
  toggleAvoided,
  togglePinned,
  type WorkerPreference,
} from "@/lib/worker-preference";
import type { OnChainJob } from "@/lib/protocol/session";
import type { SettlementProgress } from "@/lib/protocol/settlement";
import {
  formatLatencyMs,
  type StreamMetricsSnapshot,
} from "@/lib/protocol/stream-metrics";
import {
  checkProofAgainstChain,
  type ResponseProof,
  recoverProofSigner,
  type VerificationStatus,
} from "@/lib/protocol/verify-response";
import { cn } from "@/lib/utils";
import { formatLcai } from "@/lib/lcai";
import { SettlementTimeline } from "./settlement-timeline";

/**
 * The provenance chip: one line under every assistant answer saying WHO
 * computed it, WHAT it cost, and WHETHER that is provable — worker address,
 * stake at risk, throughput, TTFT, and the verification verdict, all backed
 * by chain reads and browser-side crypto rather than by trusting the API.
 *
 * It merges what used to be two separate footers (the generation-stats badge
 * and the proof badge) and hosts the settlement timeline when expanded. The
 * verify pulse fires once, when the proof check lands green — the brand
 * gradient is reserved for exactly this kind of "live proof" moment.
 *
 * Honesty rules: the verdict is recomputed from the persisted
 * (signature, digest) pair on every mount; a legacy proof without a persisted
 * signature says "not re-provable" rather than borrowing trust from the
 * stored address; a message with no proof at all shows no green, ever.
 */
function PureProvenanceChip({
  stats,
  proof,
  metrics,
  settlement,
  live,
  jobId: jobIdProp,
  fallbackWorker,
  fetchOnChainJob,
  fetchWorkerStake,
  explorerBaseUrl,
  disputeResponseMismatch,
  hasMismatchEvidence,
  servedModelId,
}: {
  stats: GenerationStats | null;
  proof: ResponseProof | null;
  metrics: StreamMetricsSnapshot | null;
  settlement: SettlementProgress | null;
  /** True while this message's stream is still open. */
  live: boolean;
  /** On-chain job id from message metadata, when one was recorded. */
  jobId?: number;
  /** Worker from the job tracker, before any chain read lands. */
  fallbackWorker?: string;
  fetchOnChainJob?: (jobId: number) => Promise<OnChainJob | null>;
  fetchWorkerStake?: (worker: string) => Promise<bigint | null>;
  explorerBaseUrl?: string;
  disputeResponseMismatch?: (jobId: number) => Promise<{ txHash: string }>;
  hasMismatchEvidence?: (jobId: number) => boolean;
  /** Friendly catalogue id of the serving model, from protocolMeta.model. */
  servedModelId?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [job, setJob] = useState<OnChainJob | null>(null);
  const [freshSigner, setFreshSigner] = useState<Address | null>(null);
  const [stake, setStake] = useState<bigint | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [disputePending, setDisputePending] = useState(false);
  // One-shot flag for the gradient pulse when verification first lands green.
  const [pulse, setPulse] = useState(false);

  const jobId = proof?.jobId ?? jobIdProp ?? null;

  useEffect(() => {
    if (!(jobId !== null && fetchOnChainJob)) {
      // Nothing to verify against the chain (live stream before the terminal
      // frame, or a legacy answer with no proof part) — render what we have.
      setLoaded(true);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const signerPromise = proof
      ? recoverProofSigner(proof).catch(() => null)
      : Promise.resolve(null);
    const poll = async (attempt: number) => {
      const [result, signer] = await Promise.all([
        fetchOnChainJob(jobId).catch(() => null),
        signerPromise,
      ]);
      if (cancelled) return;
      setJob(result);
      setFreshSigner(signer);
      setLoaded(true);
      // The first read fires when the terminal frame lands — a few seconds
      // BEFORE the worker's completeJob tx mines, so the commitment is often
      // not visible yet. Re-read on a bounded schedule until it is; without
      // this the chip would sit at "not settled" forever on a healthy job.
      const commitmentVisible =
        result?.responseCiphertextHash &&
        result.responseCiphertextHash !== ZERO_HASH;
      if (
        !(commitmentVisible || cancelled) &&
        proof &&
        attempt < MAX_JOB_REREADS
      ) {
        timer = setTimeout(() => poll(attempt + 1), JOB_REREAD_INTERVAL_MS);
      }
    };
    poll(0);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [proof, jobId, fetchOnChainJob]);

  // Stake backs the "staked on honesty" line; it is supporting detail, so it
  // is fetched only when the panel is open and the worker is known.
  useEffect(() => {
    if (!(expanded && fetchWorkerStake) || stake !== null) return;
    const worker = job?.worker ?? verificationWorker(proof, freshSigner);
    if (!worker) return;
    let cancelled = false;
    fetchWorkerStake(worker)
      .then((result) => {
        if (!cancelled) setStake(result);
      })
      .catch(() => {
        // Decoration only; its absence must not disturb the verdict.
      });
    return () => {
      cancelled = true;
    };
  }, [expanded, job, proof, freshSigner, stake, fetchWorkerStake]);

  const verification =
    proof && loaded ? checkProofAgainstChain(proof, job, freshSigner) : null;
  const status: VerificationStatus = verification?.status ?? "pending";

  // Fire the one-shot gradient pulse the first time the verdict lands green.
  useEffect(() => {
    if (status === "verified" && !pulse) {
      setPulse(true);
    }
  }, [status, pulse]);

  if (!loaded) return null;

  const worker =
    job?.worker ?? verificationWorker(proof, freshSigner) ?? fallbackWorker;
  const settled = settlement?.stage === "settled";
  const failed = settlement?.stage === "failed";

  // The worker's own count when the stats frame has landed, otherwise the
  // live estimate, marked "~" as it is in the summary row. Derived once so the
  // row and the expanded field can never disagree.
  const throughputLabel =
    stats && stats.evalTokens > 0
      ? `${stats.evalTokens.toLocaleString()} tok · ${stats.tokensPerSecond.toFixed(1)} tok/s`
      : metrics?.tokensPerSecondEstimate != null
        ? `~${metrics.tokensPerSecondEstimate.toFixed(1)} tok/s`
        : null;

  const handleMismatchDispute = async () => {
    if (!(disputeResponseMismatch && proof)) return;
    setDisputePending(true);
    try {
      await disputeResponseMismatch(proof.jobId);
      toast.success(
        "Cryptographic mismatch dispute filed. The worker's stake is on the line."
      );
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Mismatch dispute failed"
      );
    } finally {
      setDisputePending(false);
    }
  };

  return (
    <div className="mt-1">
      <motion.button
        animate={
          pulse
            ? {
                boxShadow: [
                  "0 0 0 0 rgba(102,75,253,0)",
                  "0 0 0 4px rgba(102,75,253,0.35)",
                  "0 0 0 0 rgba(102,75,253,0)",
                ],
              }
            : undefined
        }
        aria-expanded={expanded}
        className={cn(
          "flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md px-1.5 py-0.5 text-xs transition-colors hover:bg-surface-base-faint",
          status === "verified" && "text-emerald-600 dark:text-emerald-400",
          status === "mismatch" && "text-red-600 dark:text-red-400",
          (status === "pending" || status === "unverified") &&
            "text-content-subtle"
        )}
        data-testid="provenance-chip"
        onClick={() => setExpanded((v) => !v)}
        transition={{ duration: 0.4 }}
        type="button"
      >
        <StatusIcon
          failed={failed}
          live={live}
          settled={settled}
          status={status}
        />
        <span>{statusLabel(status, live, settled, failed)}</span>
        {/* Who served it and how fast are diagnostics, not the verdict. On a
            phone they wrap the chip onto a second line immediately under the
            answer — the place the eye goes next — so below `sm` they stay
            behind the expander, where each one is repeated as a field. */}
        {worker && (
          <span
            className="hidden font-mono text-[11px] sm:inline"
            title={worker}
          >
            {truncateAddress(worker)}
          </span>
        )}
        {metrics?.ttftMs != null && (
          <span className="hidden font-mono text-[11px] sm:inline">
            TTFT {formatLatencyMs(metrics.ttftMs)}
          </span>
        )}
        {throughputLabel && (
          <span className="hidden font-mono text-[11px] sm:inline">
            {throughputLabel}
          </span>
        )}
        <ChevronDown
          className={cn("transition-transform", expanded && "rotate-180")}
          size={12}
        />
      </motion.button>

      {expanded && (
        <div className="mt-1.5 space-y-2.5 rounded-md border border-bdr-light px-2.5 py-2 text-xs">
          {settlement && (
            <SettlementTimeline
              live={live && !settled && !failed}
              settlement={settlement}
              verification={proof ? status : null}
            />
          )}

          {stake !== null && worker && (
            <p className="text-content-subtle">
              This worker has{" "}
              <span className="font-medium font-mono text-content-strong">
                {formatLcai(stake)}
              </span>{" "}
              staked on honesty — a successful dispute slashes it.
            </p>
          )}

          {verification?.detail && (
            <p className="text-content-subtle">{verification.detail}</p>
          )}

          {verification && (
            <dl className="space-y-1">
              <CheckRow
                label="Signature recovers to the assigned worker"
                value={verification.signatureMatches}
              />
              <CheckRow
                label="Answer matches the hash committed on chain"
                value={verification.ciphertextMatches}
              />
            </dl>
          )}

          {proof &&
            status === "mismatch" &&
            disputeResponseMismatch &&
            (hasMismatchEvidence?.(proof.jobId) ? (
              <button
                className="inline-flex items-center gap-1 rounded-md border border-red-300 px-2 py-1 font-medium text-red-700 text-xs hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/40"
                disabled={disputePending}
                onClick={handleMismatchDispute}
                type="button"
              >
                <ShieldAlert size={12} />
                {disputePending
                  ? "Filing dispute…"
                  : "File cryptographic mismatch dispute"}
              </button>
            ) : (
              <p className="text-content-subtle">
                Cryptographic dispute evidence is only kept for the session that
                received this answer; after a reload only a bond dispute is
                available. Either way, disputes close once the on-chain dispute
                window has elapsed after job completion.
              </p>
            ))}

          {/* The summary row drops these below `sm`, so they are restated here
              as fields. Stands on its own rather than joining the dl below,
              because timings exist for a streamed answer whether or not the
              proof and the on-chain job have been read back yet. */}
          {(worker || metrics?.ttftMs != null || throughputLabel) && (
            <dl className="space-y-1">
              {worker && <Field label="Served by" mono value={worker} />}
              {metrics?.ttftMs != null && (
                <Field
                  label="Time to first token"
                  value={formatLatencyMs(metrics.ttftMs)}
                />
              )}
              {throughputLabel && (
                <Field label="Throughput" value={throughputLabel} />
              )}
            </dl>
          )}

          {(proof || job) && (
            <dl className="space-y-1">
              {jobId !== null && <Field label="Job" value={`#${jobId}`} />}
              {servedModelId && <Field label="Model" value={servedModelId} />}
              {job && (
                <>
                  {/* What this answer actually cost, read from the chain rather
                      than the model catalogue. */}
                  <Field label="Paid" value={formatLcai(job.escrowedFee)} />
                  <Field label="Worker" mono value={job.worker} />
                  {/* Acting on who answered you belongs next to who answered
                      you. Held in this browser and sent per request, so no
                      server keeps a record of which workers a person will
                      accept. */}
                  <WorkerPreferenceControls worker={job.worker} />
                  <Field label="Prompt blob" mono value={job.promptBlobHash} />
                  <Field
                    label="Response blob"
                    mono
                    value={job.responseBlobHash}
                  />
                  <Field
                    label="Submitted in block"
                    value={String(job.submitBlockNumber)}
                  />
                  {job.completionBlockNumber > 0 && (
                    <Field
                      label="Completed in block"
                      value={String(job.completionBlockNumber)}
                    />
                  )}
                </>
              )}
            </dl>
          )}

          {job && explorerBaseUrl && (
            <a
              className="inline-block text-content-link hover:underline"
              href={`${explorerBaseUrl}/address/${job.worker}`}
              rel="noreferrer noopener"
              target="_blank"
            >
              View worker on the explorer
            </a>
          )}
        </div>
      )}
    </div>
  );
}

function verificationWorker(
  proof: ResponseProof | null,
  freshSigner: Address | null
): string | null {
  if (!proof) return null;
  return freshSigner ?? proof.recoveredSigner ?? null;
}

function statusLabel(
  status: VerificationStatus,
  live: boolean,
  settled: boolean,
  failed: boolean
): string {
  if (failed) return "Delivery failed";
  if (status === "verified") return "Verified";
  if (status === "mismatch") return "Verification failed";
  if (live && !settled) return "Settling";
  return "Not verified";
}

function StatusIcon({
  status,
  live,
  settled,
  failed,
}: {
  status: VerificationStatus;
  live: boolean;
  settled: boolean;
  failed: boolean;
}) {
  if (status === "verified") return <ShieldCheck size={12} />;
  if (status === "mismatch") return <ShieldAlert size={12} />;
  if (failed) return <ShieldAlert size={12} />;
  if (live && !settled) {
    // The only gradient element at rest in the app: proof is being produced.
    return (
      <span className="size-2 animate-pulse rounded-full bg-gradient-primary" />
    );
  }
  return <ShieldQuestion size={12} />;
}

function truncateAddress(address: string): string {
  if (!address.startsWith("0x") || address.length < 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}


const ZERO_HASH =
  "0x0000000000000000000000000000000000000000000000000000000000000000";
/** Bounded re-read schedule for the post-terminal-frame race with mining. */
const MAX_JOB_REREADS = 24;
const JOB_REREAD_INTERVAL_MS = 5000;


function CheckRow({ label, value }: { label: string; value: boolean | null }) {
  const mark = value === true ? "yes" : value === false ? "no" : "n/a";
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-content-subtle">{label}</dt>
      <dd
        className={cn(
          "shrink-0 font-medium",
          value === true && "text-emerald-600 dark:text-emerald-400",
          value === false && "text-red-600 dark:text-red-400"
        )}
      >
        {mark}
      </dd>
    </div>
  );
}

/**
 * Avoid / pin controls for the worker that answered.
 *
 * Sortition decides who may claim, so this can only decline what was drawn —
 * the consumer-api re-draws a bounded number of times and then answers with
 * whoever claimed. The copy says "prefer" and "avoid" rather than "block" and
 * "choose" so nobody reads it as a guarantee it cannot make.
 */
function WorkerPreferenceControls({ worker }: { worker: string }) {
  // Re-read after each toggle rather than holding a copy: the same worker can
  // appear on several messages at once, and stale buttons would disagree.
  const [preference, setPreference] = useState<WorkerPreference>(() => ({
    avoid: [],
  }));

  useEffect(() => {
    setPreference(readWorkerPreference());
  }, []);

  const avoided = isAvoided(worker, preference);
  const pinned = isPinned(worker, preference);

  return (
    <div className="flex items-baseline justify-between gap-3 pt-0.5">
      <dt className="shrink-0 text-content-subtle">Preference</dt>
      <dd className="flex min-w-0 gap-1.5">
        <button
          aria-pressed={pinned}
          className={cn(
            "rounded-sm px-1.5 py-0.5 text-[11px] transition-colors",
            pinned
              ? "bg-primary/10 text-primary"
              : "text-content-subtle hover:text-content-strong"
          )}
          onClick={() => setPreference(togglePinned(worker))}
          type="button"
        >
          {pinned ? "Preferred" : "Prefer"}
        </button>
        <button
          aria-pressed={avoided}
          className={cn(
            "rounded-sm px-1.5 py-0.5 text-[11px] transition-colors",
            avoided
              ? "bg-red-500/10 text-red-600 dark:text-red-400"
              : "text-content-subtle hover:text-content-strong"
          )}
          onClick={() => setPreference(toggleAvoided(worker))}
          type="button"
        >
          {avoided ? "Avoided" : "Avoid"}
        </button>
      </dd>
    </div>
  );
}

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-content-subtle">{label}</dt>
      <dd
        className={cn(
          "min-w-0 truncate text-content-strong",
          mono && "font-mono text-[11px]"
        )}
        title={value}
      >
        {value}
      </dd>
    </div>
  );
}

export const ProvenanceChip = memo(PureProvenanceChip);
