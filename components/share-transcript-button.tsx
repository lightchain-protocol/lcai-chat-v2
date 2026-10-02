"use client";

import { Share2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { buildVerifiableTranscript } from "@/lib/share/verifiable-transcript";
import type { ChatMessage } from "@/lib/types";

/**
 * "Create public verifiable link" — the explicit-consent export for the
 * shareable verifiable transcript.
 *
 * The payload is plaintext by design (owner decision 2026-08-23): it carries
 * only what the user already saw, plus the terminal-frame ciphertext +
 * signature while the live session still holds them. Anyone with the file or
 * link can re-verify it against the chain on the /share page — which is the
 * point — so the consent dialog warns that the conversation becomes public.
 *
 * Delivery is hash-or-file, no server: small payloads ride the /share URL
 * hash; large ones download as .json for the verifier's file picker.
 */
const MAX_HASH_PAYLOAD_CHARS = 6000;

const TRAILING_PADDING = /=+$/;

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(TRAILING_PADDING, "");
}

export function ShareTranscriptButton({
  chatId,
  chatTitle,
  messages,
  getShareEvidence,
}: {
  chatId: string;
  chatTitle?: string;
  messages: ChatMessage[];
  /** Live-session evidence lookup; absent in non-protocol mode. */
  getShareEvidence?: (
    jobId: number
  ) => { ciphertext: string; signature: string } | null;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);

  const provableCount = messages.filter((m) =>
    m.parts.some(
      (p) =>
        p.type === "data-responseProof" && typeof p.data?.jobId === "number"
    )
  ).length;

  const doExport = () => {
    // Fold the live-session evidence (ciphertext + signature) in by jobId.
    const evidence = new Map<
      number,
      { ciphertext: string; signature?: string | null }
    >();
    if (getShareEvidence) {
      for (const message of messages) {
        for (const part of message.parts) {
          if (
            part.type === "data-responseProof" &&
            typeof part.data?.jobId === "number"
          ) {
            const live = getShareEvidence(part.data.jobId);
            if (live) evidence.set(part.data.jobId, live);
          }
        }
      }
    }

    const doc = buildVerifiableTranscript({
      chatId,
      title: chatTitle,
      messages,
      evidence,
    });
    const json = JSON.stringify(doc);
    const filename = `lightchain-transcript-${chatId.slice(0, 8)}.json`;

    // The file always downloads — it is the lossless form. The hash link is
    // the convenient form when it fits.
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);

    const hash = toBase64Url(json);
    if (hash.length <= MAX_HASH_PAYLOAD_CHARS) {
      const link = `${window.location.origin}/share#${hash}`;
      navigator.clipboard
        .writeText(link)
        .then(() =>
          toast.success("Verifiable link copied — file downloaded too")
        )
        .catch(() => toast.success("Transcript downloaded"));
    } else {
      toast.success(
        "Transcript downloaded (too large for a link — open it on the /share page)"
      );
    }
  };

  if (provableCount === 0) return null;

  return (
    <>
      <Button
        className="h-8 gap-1.5 rounded-lg px-2 font-normal text-sm"
        data-testid="share-transcript-button"
        onClick={() => setConfirmOpen(true)}
        title="Export this conversation as a publicly verifiable transcript"
        type="button"
        variant="ghost"
      >
        <Share2 size={14} />
        <span className="hidden text-content-secondary sm:block">Verify</span>
      </Button>

      <AlertDialog onOpenChange={setConfirmOpen} open={confirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Create a public verifiable link?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This exports the whole conversation — every message, plus the
              on-chain proof evidence for {provableCount} answer
              {provableCount === 1 ? "" : "s"}. Anyone with the link or file can
              read the content and re-verify it against the chain. This cannot
              be unshared.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmOpen(false);
                doExport();
              }}
            >
              Export publicly
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
