"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPublicClient, http } from "viem";
import config from "@/config";
import { jobRegistryAbi } from "@/contracts/job-registry-abi";
import type { VerifiableTranscript } from "@/lib/share/verifiable-transcript";
import {
  BLOB_CAVEAT,
  SHARE_VERDICT_LABELS,
  type ShareVerdictResult,
  verifyShareEntry,
} from "@/lib/share/verify-transcript";

/**
 * Public verifier for shareable verifiable transcripts
 * (bc-2-duel-and-verifier-spec.md §2). Self-contained: the payload arrives via
 * URL hash or a dropped/picked .json file — no server, no wallet, no login.
 *
 * What a green verdict means, exactly: "the worker whose address is recorded
 * on chain for this job signed exactly these ciphertext bytes, and the hash of
 * these bytes is what that worker committed in completeJob". The honesty
 * boundary below (§2.4) is rendered on every page view — it is part of the
 * proof surface, not fine print.
 */

function fromBase64Url(encoded: string): string {
  const b64 = encoded.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Every field of `share` is optional except jobId/sessionId, which anchor the on-chain re-verification. */
function isValidShare(value: unknown): boolean {
  if (value === undefined) return true;
  if (!isPlainObject(value)) return false;
  if (typeof value.jobId !== "number" || typeof value.sessionId !== "number") {
    return false;
  }
  return (
    (value.renderedText === undefined ||
      typeof value.renderedText === "string") &&
    (value.ciphertext === undefined || typeof value.ciphertext === "string") &&
    (value.signature === undefined || typeof value.signature === "string")
  );
}

/** Shape guard for an untrusted document from a URL hash or a picked file. */
function isValidTranscriptDoc(doc: unknown): doc is VerifiableTranscript {
  if (!isPlainObject(doc) || doc.v !== 1) return false;
  if (!isPlainObject(doc.chat) || typeof doc.chat.id !== "string") {
    return false;
  }
  if (!Array.isArray(doc.messages)) return false;
  return doc.messages.every(
    (m) =>
      isPlainObject(m) &&
      typeof m.role === "string" &&
      typeof m.text === "string" &&
      isValidShare(m.share)
  );
}

type EntryState =
  | { status: "verifying" }
  | { status: "done"; result: ShareVerdictResult }
  | { status: "no-share" }
  | { status: "error"; message: string };

const VERDICT_STYLES: Record<string, string> = {
  verified: "border-green-600/40 bg-green-600/10 text-green-500",
  "mismatch-content": "border-red-600/40 bg-red-600/10 text-red-500",
  "mismatch-signature": "border-red-600/40 bg-red-600/10 text-red-500",
  invalid: "border-red-600/40 bg-red-600/10 text-red-500",
  pending: "border-yellow-600/40 bg-yellow-600/10 text-yellow-500",
  partial: "border-yellow-600/40 bg-yellow-600/10 text-yellow-500",
  "missing-evidence": "border-yellow-600/40 bg-yellow-600/10 text-yellow-500",
};

export default function SharePage() {
  const chain = config.chains[0];
  const registryAddress = config.jobRegistryAddress[chain.id];

  const publicClient = useMemo(
    () => createPublicClient({ chain, transport: http() }),
    [chain]
  );

  const [transcript, setTranscript] = useState<VerifiableTranscript | null>(
    null
  );
  const [parseError, setParseError] = useState<string | null>(null);
  const [entries, setEntries] = useState<Record<number, EntryState>>({});

  const load = useCallback((raw: string) => {
    try {
      const doc: unknown = JSON.parse(raw);
      if (!isValidTranscriptDoc(doc)) {
        setParseError("Could not parse that transcript file/link.");
        return;
      }
      setTranscript(doc);
      setParseError(null);
    } catch {
      setParseError("Could not parse that transcript file/link.");
    }
  }, []);

  // URL hash form: /share#<base64url JSON>.
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (!hash) return;
    try {
      load(fromBase64Url(hash));
    } catch {
      setParseError("Could not parse that transcript file/link.");
    }
  }, [load]);

  // Verify each entry with share evidence against the chain.
  useEffect(() => {
    if (!transcript || !registryAddress) return;
    let cancelled = false;

    transcript.messages.forEach((message, index) => {
      const share = message.share;
      if (!share) {
        setEntries((prev) => ({ ...prev, [index]: { status: "no-share" } }));
        return;
      }
      setEntries((prev) => ({ ...prev, [index]: { status: "verifying" } }));
      (async () => {
        const job = await publicClient.readContract({
          address: registryAddress,
          abi: jobRegistryAbi,
          functionName: "getJob",
          args: [BigInt(share.jobId)],
        });
        return verifyShareEntry(
          share,
          {
            worker: job.worker,
            state: job.state,
            sessionId: Number(job.sessionId),
            responseCiphertextHash: job.responseCiphertextHash,
          },
          chain.id,
          registryAddress
        );
      })()
        .then((result) => {
          if (cancelled) return;
          setEntries((prev) => ({
            ...prev,
            [index]: { status: "done", result },
          }));
        })
        .catch((error) => {
          if (cancelled) return;
          setEntries((prev) => ({
            ...prev,
            [index]: {
              status: "error",
              message:
                error instanceof Error ? error.message : "chain read failed",
            },
          }));
        });
    });

    return () => {
      cancelled = true;
    };
  }, [transcript, publicClient, registryAddress, chain.id]);

  return (
    <div className="mx-auto flex min-h-svh max-w-2xl flex-col gap-6 p-6">
      <header>
        <h1 className="font-semibold text-2xl text-content-ultra">
          Verifiable transcript
        </h1>
        <p className="mt-1 text-content-secondary text-sm">
          Re-verified against the chain in your browser — nothing here trusts
          the file or the sharer.
        </p>
      </header>

      {!transcript && !parseError && (
        <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-bdr-light border-dashed p-8 text-content-secondary text-sm">
          Open a transcript .json file
          <input
            accept="application/json"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              file.text().then(load);
            }}
            type="file"
          />
        </label>
      )}

      {parseError && (
        <p className="rounded-lg border border-red-600/40 bg-red-600/10 p-3 text-red-500 text-sm">
          {parseError}
        </p>
      )}

      {transcript && (
        <>
          <p className="text-content-subtle text-xs">
            Chat {transcript.chat.id}
            {transcript.chat.title ? ` · ${transcript.chat.title}` : ""} ·
            exported {transcript.exportedAt}
          </p>

          {transcript.messages.map((message, index) => {
            const entry = entries[index];
            // Only proof-carrying (assistant) messages get share.renderedText;
            // plain entries (e.g. user prompts) still carry text — show it
            // with the same sharer-provided honesty note, or the transcript
            // loses every prompt.
            const bodyText = message.share?.renderedText ?? message.text;
            return (
              <div
                className="rounded-xl border border-bdr-light p-4"
                key={`${index}-${message.role}`}
              >
                <p className="mb-1 font-medium text-[10px] text-content-subtle uppercase">
                  {message.role}
                </p>
                {bodyText && (
                  <>
                    <p className="whitespace-pre-wrap text-content-default text-sm">
                      {bodyText}
                    </p>
                    {/* Honesty boundary §2.4.1 — rendered on every entry. */}
                    <p className="mt-1 text-[10px] text-content-subtle italic">
                      Decrypted and displayed by the sharer; the chain proof
                      covers the ciphertext, not this rendering.
                    </p>
                  </>
                )}

                {entry?.status === "verifying" && (
                  <p className="mt-2 text-content-secondary text-xs">
                    Verifying against chain {chain.id}…
                  </p>
                )}
                {entry?.status === "error" && (
                  <p className="mt-2 text-red-500 text-xs">
                    Chain read failed: {entry.message}
                  </p>
                )}
                {entry?.status === "done" && (
                  <div
                    className={`mt-2 rounded-lg border px-3 py-2 text-xs ${VERDICT_STYLES[entry.result.verdict]}`}
                  >
                    <p className="font-medium">
                      {SHARE_VERDICT_LABELS[entry.result.verdict]}
                    </p>
                    {entry.result.signer && (
                      <p className="mt-1 font-mono text-[10px] opacity-80">
                        signer {entry.result.signer}
                      </p>
                    )}
                    {entry.result.ciphertextHash && (
                      <p className="font-mono text-[10px] opacity-80">
                        keccak256(ciphertext) {entry.result.ciphertextHash}
                      </p>
                    )}
                    <p className="mt-1 font-mono text-[10px] opacity-80">
                      job {message.share?.jobId} · session{" "}
                      {message.share?.sessionId}
                    </p>
                  </div>
                )}
              </div>
            );
          })}

          {/* Honesty boundary (bc-2 spec §2.4) — part of the proof surface. */}
          <section className="rounded-xl border border-bdr-light p-4 text-content-secondary text-xs">
            <h2 className="mb-2 font-semibold text-content-default text-sm">
              What this page cannot verify
            </h2>
            <ul className="list-disc space-y-1.5 pl-4">
              <li>
                The plaintext. Rendered text above is decrypted and displayed by
                the sharer; the chain proof covers the ciphertext, not the
                rendering.
              </li>
              <li>
                Content correctness. Settlement proves delivery and identity,
                not that the answer is faithful or correct.
              </li>
              <li>Blob availability/content. {BLOB_CAVEAT}</li>
              <li>
                Non-text content. Reasoning, artifacts, audio, and stats carry
                no on-chain commitment today — no provenance claim is shown for
                them here.
              </li>
              <li>
                The sharer&apos;s identity. The paying account is recorded on
                chain; nothing proves the person sharing this link controls it.
              </li>
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
