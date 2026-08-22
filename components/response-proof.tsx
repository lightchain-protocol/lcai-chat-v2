"use client";

import {
  ChevronDown,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
} from "lucide-react";
import { memo, useEffect, useState } from "react";
import type { OnChainJob } from "@/lib/protocol/session";
import {
  checkProofAgainstChain,
  type ResponseProof,
  type VerificationStatus,
} from "@/lib/protocol/verify-response";
import { cn } from "@/lib/utils";

/**
 * Shows whether an answer provably came from the worker that was paid for it.
 *
 * Two independent checks, both run in this browser against data it already
 * holds: the worker's signature recovers to the address the chain assigned,
 * and the answer hashes to the value the worker committed in completeJob.
 * Nothing here trusts the relay or the API — which is the point, and something
 * no centralized assistant can offer.
 */
function PureResponseProof({
  proof,
  fetchOnChainJob,
  fetchWorkerStake,
  explorerBaseUrl,
}: {
  proof: ResponseProof;
  fetchOnChainJob: (jobId: number) => Promise<OnChainJob | null>;
  fetchWorkerStake?: (worker: string) => Promise<bigint | null>;
  explorerBaseUrl?: string;
}) {
  const [job, setJob] = useState<OnChainJob | null>(null);
  const [stake, setStake] = useState<bigint | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchOnChainJob(proof.jobId)
      .then((result) => {
        if (cancelled) return;
        setJob(result);
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [proof.jobId, fetchOnChainJob]);

  // Stake is only worth fetching once the panel is open and the worker is
  // known — it is supporting detail, not part of the headline verdict.
  useEffect(() => {
    if (!(expanded && job && fetchWorkerStake) || stake !== null) return;
    let cancelled = false;
    fetchWorkerStake(job.worker)
      .then((result) => {
        if (!cancelled) setStake(result);
      })
      .catch(() => {
        // Stake is decoration; its absence must not disturb the verdict.
      });
    return () => {
      cancelled = true;
    };
  }, [expanded, job, fetchWorkerStake, stake]);

  const verification = checkProofAgainstChain(proof, job);
  // Until the chain read lands there is nothing meaningful to claim, and a
  // badge that flickers from "unverified" to "verified" reads as a bug.
  if (!loaded) return null;

  return (
    <div className="mt-1">
      <button
        aria-expanded={expanded}
        className={cn(
          "flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs transition-colors hover:bg-surface-base-faint",
          toneClass(verification.status)
        )}
        onClick={() => setExpanded((v) => !v)}
        type="button"
      >
        <StatusIcon status={verification.status} />
        <span>{STATUS_LABEL[verification.status]}</span>
        <ChevronDown
          className={cn("transition-transform", expanded && "rotate-180")}
          size={12}
        />
      </button>

      {expanded && (
        <dl className="mt-1.5 space-y-1 rounded-md border border-bdr-light px-2.5 py-2 text-xs">
          {verification.detail && (
            <p className="mb-1.5 text-content-subtle">{verification.detail}</p>
          )}

          <CheckRow
            label="Signature recovers to the assigned worker"
            value={verification.signatureMatches}
          />
          <CheckRow
            label="Answer matches the hash committed on chain"
            value={verification.ciphertextMatches}
          />

          <Field label="Job" value={`#${proof.jobId}`} />
          {job && (
            <>
              {/* What this answer actually cost, read from the chain rather
                  than from the model catalogue, so it reflects the fee that
                  was escrowed at submit time. */}
              <Field label="Paid" value={formatLcai(job.escrowedFee)} />
              <Field label="Worker" mono value={job.worker} />
              {stake !== null && (
                // What a successful dispute would slash — the concrete measure
                // of how much this answer is backed by.
                <Field label="Worker stake" value={formatLcai(stake)} />
              )}
              <Field label="Prompt blob" mono value={job.promptBlobHash} />
              <Field label="Response blob" mono value={job.responseBlobHash} />
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
              {explorerBaseUrl && (
                <a
                  className="mt-1 inline-block text-content-link hover:underline"
                  href={`${explorerBaseUrl}/address/${job.worker}`}
                  rel="noreferrer noopener"
                  target="_blank"
                >
                  View worker on the explorer
                </a>
              )}
            </>
          )}
        </dl>
      )}
    </div>
  );
}

const STATUS_LABEL: Record<VerificationStatus, string> = {
  verified: "Verified",
  unverified: "Not verified",
  mismatch: "Verification failed",
  pending: "Verifying",
};

/**
 * Formats a wei amount as LCAI.
 *
 * Fees on this network are small fractions, so a fixed-decimal render would be
 * all zeros; this trims to the first significant digits instead.
 */
const TRAILING_ZEROS = /0+$/;

function formatLcai(wei: bigint): string {
  const whole = wei / 10n ** 18n;
  const frac = wei % 10n ** 18n;
  if (frac === 0n) return `${whole} LCAI`;
  const padded = frac.toString().padStart(18, "0").replace(TRAILING_ZEROS, "");
  return `${whole}.${padded.slice(0, 6)} LCAI`;
}

function toneClass(status: VerificationStatus): string {
  if (status === "verified") return "text-emerald-600 dark:text-emerald-400";
  if (status === "mismatch") return "text-red-600 dark:text-red-400";
  return "text-content-subtle";
}

function StatusIcon({ status }: { status: VerificationStatus }) {
  if (status === "verified") return <ShieldCheck size={12} />;
  if (status === "mismatch") return <ShieldAlert size={12} />;
  return <ShieldQuestion size={12} />;
}

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

export const ResponseProofPanel = memo(PureResponseProof);
