"use client";

import type { DialogProps } from "@radix-ui/react-dialog";
import { Loader2Icon, Swords, X } from "lucide-react";
import { useState } from "react";
import { formatEther, parseEther } from "viem";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import usePrepaidBalance from "@/hooks/use-prepaid-balance";
import { chatModels, formatFee, getChatModel } from "@/lib/ai/models";
import { checkDuelFunding, duelHeading } from "@/lib/protocol/duel";
import { cn } from "@/lib/utils";

/**
 * Multi-model duel picker (bc-2-duel-and-verifier-spec.md §1).
 *
 * A duel runs the current prompt on two models as two independent paid jobs —
 * two protocol sessions, two escrows — and renders the answers side by side.
 * Funding is amortized through the prepaid balance, so the precheck here
 * mirrors the contract's execution-time checks (balance AND delegate
 * allowance must each cover feeA + feeB) instead of letting a guaranteed
 * revert through.
 *
 * The current model is excluded from the side-B list: a same-model duel is
 * two correlated runs, not a comparison, and that honesty burden is deferred
 * rather than smuggled into the UI.
 */
export function DuelDialog({
  currentModelId,
  onConfirm,
  onOpenPrepaid,
  ...dialogProps
}: DialogProps & {
  currentModelId: string;
  onConfirm: (modelBId: string) => void;
  /** Routes a funding shortfall to the existing top-up / authorize dialog. */
  onOpenPrepaid: () => void;
}) {
  const pb = usePrepaidBalance();
  const candidates = chatModels.filter((m) => m.id !== currentModelId);
  const [selectedId, setSelectedId] = useState<string>(candidates[0]?.id ?? "");

  const modelA = getChatModel(currentModelId);
  const modelB = getChatModel(selectedId);

  const funding =
    modelA && modelB
      ? checkDuelFunding({
          isAuthorized: pb.isAuthorized,
          balanceWei: pb.balance,
          allowanceWei: pb.allowance,
          feeWeiA: parseEther(String(modelA.fee)),
          feeWeiB: parseEther(String(modelB.fee)),
        })
      : null;

  const totalLCAI = (modelA?.fee ?? 0) + (modelB?.fee ?? 0);
  const runnable = funding?.ok === true && !pb.isLoading;

  return (
    <Dialog {...dialogProps}>
      <DialogContent
        className="max-h-[90vh] overflow-y-auto rounded-3xl! bg-surface-elevation-light p-0 sm:max-w-md"
        hideClose
      >
        <div className="relative overflow-hidden p-6 sm:p-8">
          <div className="-top-24 -right-20 absolute z-[-1] size-48 rounded-full bg-surface-base-brand-strong opacity-20 blur-[100px]" />

          <DialogClose asChild>
            <button
              aria-label="Close"
              className="absolute top-4 right-4 rounded-full p-1 text-content-soft hover:bg-surface-base-faint"
              type="button"
            >
              <X className="size-5" />
            </button>
          </DialogClose>

          <DialogHeader>
            <DialogTitle asChild>
              <h4 className="-tracking-[0.2px] flex items-center gap-2 font-semibold text-content-strong text-xl leading-[1.2]">
                <Swords className="size-5" />
                Model duel
              </h4>
            </DialogTitle>
            <DialogDescription className="-tracking-[0.16px] mt-1 text-base text-content-default">
              Send this prompt to{" "}
              <span className="font-medium">
                {modelA?.name ?? currentModelId}
              </span>{" "}
              and one other model as two independent paid jobs, then compare the
              answers side by side.
            </DialogDescription>
          </DialogHeader>

          <div className="my-6 h-px w-full bg-bdr-light" />

          <p className="mb-2 text-content-soft text-sm">Opponent model</p>
          <div className="flex max-h-[220px] flex-col gap-px overflow-y-auto rounded-2xl border border-bdr-light p-1">
            {candidates.map((model) => (
              <button
                className={cn(
                  "flex items-baseline justify-between gap-2 rounded-xl px-3 py-2 text-left text-sm transition-colors hover:bg-surface-base-faint",
                  model.id === selectedId &&
                    "bg-surface-base-faint font-medium text-content-strong"
                )}
                key={model.id}
                onClick={() => setSelectedId(model.id)}
                type="button"
              >
                <span>{model.name}</span>
                <span className="text-content-light text-xs">
                  {formatFee(model.fee)}
                </span>
              </button>
            ))}
          </div>

          {modelA && modelB && (
            <p className="mt-4 text-content-soft text-sm">
              {duelHeading(modelA.name, modelB.name)} — two jobs,{" "}
              {formatFee(totalLCAI)} total, debited from your prepaid balance.
            </p>
          )}

          {funding && !funding.ok && !pb.isLoading && (
            <div className="mt-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3">
              <p className="text-amber-600 text-sm dark:text-amber-400">
                {funding.reason === "not-authorized" &&
                  "The delegate isn't authorized, so neither job could be submitted."}
                {funding.reason === "insufficient-balance" &&
                  `This duel needs ${formatEther(funding.totalWei)} LCAI; your prepaid balance has ${formatEther(funding.availableWei)} LCAI.`}
                {funding.reason === "insufficient-allowance" &&
                  `The delegate spending limit is ${formatEther(funding.availableWei)} LCAI but this duel needs ${formatEther(funding.totalWei)} LCAI.`}
              </p>
              <Button
                className="mt-2 h-8 text-xs"
                onClick={onOpenPrepaid}
                size="sm"
                variant="secondary"
              >
                Open chat balance
              </Button>
            </div>
          )}

          <Button
            className="mt-6 w-full"
            disabled={!runnable || !modelB}
            onClick={() => modelB && onConfirm(modelB.id)}
          >
            {pb.isLoading ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              `Run 2 paid jobs (~${formatFee(totalLCAI)})`
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
