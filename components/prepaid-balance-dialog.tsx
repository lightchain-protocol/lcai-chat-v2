"use client";

import type { DialogProps } from "@radix-ui/react-dialog";
import { CheckCircle2, Loader2Icon, ShieldCheck, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { formatEther } from "viem";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import usePrepaidBalance from "@/hooks/use-prepaid-balance";
import { cn } from "@/lib/utils";
import { parseWeb3Error } from "@/lib/utils/web3-errors";
import AlertError from "./ui/toast/AlertError";
import AlertSuccess from "./ui/toast/AlertSuccess";

function showError(error: unknown) {
  const { title, description } = parseWeb3Error(error);
  toast.custom((id) => (
    <AlertError description={description} id={id} title={title} />
  ));
}

export function PrepaidBalanceDialog(props: DialogProps) {
  const pb = usePrepaidBalance();
  const [depositAmount, setDepositAmount] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");

  const balanceLCAI = formatEther(pb.balance);
  const allowanceLCAI = formatEther(pb.allowance);
  // Re-authorizing an already-funded balance is the only case where a standalone
  // authorize is worth a confirmation — it is the path back after a revoke,
  // without depositing again.
  const showAuthorize = !pb.isAuthorized && pb.balance > 0n;
  const busy =
    pb.depositAndAuthorizeMutation.isPending ||
    pb.withdrawMutation.isPending ||
    pb.authorizeMutation.isPending ||
    pb.revokeMutation.isPending ||
    pb.syncAllowanceMutation.isPending;

  const onDeposit = async () => {
    if (!depositAmount || Number(depositAmount) <= 0) return;
    try {
      await pb.depositAndAuthorizeMutation.mutateAsync(depositAmount);
      setDepositAmount("");
      toast.custom((id) => (
        <AlertSuccess
          id={id}
          title={
            pb.isAuthorized
              ? "Balance topped up & spending limit increased"
              : "Balance topped up & delegate authorized"
          }
        />
      ));
    } catch (error) {
      showError(error);
    }
  };

  const onWithdraw = async () => {
    if (!withdrawAmount || Number(withdrawAmount) <= 0) return;
    try {
      await pb.withdrawMutation.mutateAsync(withdrawAmount);
      setWithdrawAmount("");
      toast.custom((id) => (
        <AlertSuccess id={id} title="Withdrawn to wallet" />
      ));
    } catch (error) {
      showError(error);
    }
  };

  const onToggleDelegate = async () => {
    try {
      if (pb.isAuthorized) {
        await pb.revokeMutation.mutateAsync();
        toast.custom((id) => (
          <AlertSuccess id={id} title="Delegate authorization revoked" />
        ));
      } else {
        await pb.authorizeMutation.mutateAsync();
        toast.custom((id) => (
          <AlertSuccess
            id={id}
            title={
              pb.balance > 0n
                ? "Delegate authorized with spending limit"
                : "Delegate authorized — deposit to enable prompts"
            }
          />
        ));
      }
    } catch (error) {
      showError(error);
    }
  };

  const onSyncAllowance = async () => {
    try {
      await pb.syncAllowanceMutation.mutateAsync();
      toast.custom((id) => (
        <AlertSuccess id={id} title="Spending limit updated to full balance" />
      ));
    } catch (error) {
      showError(error);
    }
  };

  return (
    <Dialog {...props}>
      <DialogContent
        className="max-h-[90vh] overflow-y-auto rounded-3xl! bg-surface-elevation-light p-0 sm:max-w-md"
        hideClose
      >
        <div className="relative overflow-hidden p-6 sm:p-8">
          <div className="-top-24 -left-20 absolute z-[-1] size-48 rounded-full bg-surface-base-brand-strong opacity-20 blur-[100px]" />

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
              <h4 className="-tracking-[0.2px] font-semibold text-content-strong text-xl leading-[1.2]">
                Chat balance
              </h4>
            </DialogTitle>
            <DialogDescription className="-tracking-[0.16px] mt-1 text-base text-content-default">
              Deposit LCAI once; each prompt debits your balance through a
              capped delegate spending limit.
            </DialogDescription>
          </DialogHeader>

          <div className="my-6 h-px w-full bg-bdr-light" />

          {pb.available ? (
            <div className="space-y-6">
              <div className="rounded-2xl border border-bdr-light bg-surface-base-subtle p-4">
                <div className="flex items-center justify-between">
                  <span className="text-content-soft text-sm">
                    Available balance
                  </span>
                  <span className="font-semibold text-content-strong text-lg">
                    {pb.isLoading ? "…" : `${balanceLCAI} LCAI`}
                  </span>
                </div>
                {pb.isAuthorized && (
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-content-soft text-sm">
                      Delegate spending limit
                    </span>
                    <span className="font-medium text-content-default text-sm">
                      {pb.isLoading ? "…" : `${allowanceLCAI} LCAI`}
                    </span>
                  </div>
                )}
                <div className="mt-3 flex items-center justify-between gap-2">
                  {pb.ready ? (
                    <p className="text-emerald-500 text-xs">
                      Your balance is ready for gas-free prompts.
                    </p>
                  ) : (
                    <p className="text-content-light text-xs">
                      {pb.balance === 0n
                        ? "Deposit LCAI to get started."
                        : pb.isAuthorized
                          ? pb.allowance === 0n
                            ? "Set a spending limit so the delegate can submit prompts."
                            : "Increase the spending limit to match your balance."
                          : "Authorize the delegate to enable gas-free prompts."}
                    </p>
                  )}
                  <span
                    className={cn(
                      "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs",
                      pb.isAuthorized
                        ? "bg-emerald-500/10 text-emerald-500"
                        : "bg-amber-500/10 text-amber-500"
                    )}
                  >
                    {pb.isAuthorized ? (
                      <CheckCircle2 className="size-3.5" />
                    ) : (
                      <ShieldCheck className="size-3.5" />
                    )}
                    {pb.isAuthorized ? "Authorized" : "Not authorized"}
                  </span>
                </div>
                {pb.needsAllowanceSync && (
                  <Button
                    className="mt-3 h-8 w-full text-xs"
                    disabled={busy}
                    onClick={onSyncAllowance}
                    size="sm"
                    variant="secondary"
                  >
                    {pb.syncAllowanceMutation.isPending ? (
                      <Loader2Icon className="size-3.5 animate-spin" />
                    ) : (
                      `Allow delegate to spend full balance (${balanceLCAI} LCAI)`
                    )}
                  </Button>
                )}
              </div>

              <div>
                <label
                  className="mb-1.5 block text-content-soft text-sm"
                  htmlFor="prepaid-deposit"
                >
                  Top up
                </label>
                <p className="mb-2 text-content-light text-xs">
                  Deposits also increase the delegate spending limit by the same
                  amount.
                </p>
                <div className="flex gap-2">
                  <Input
                    disabled={busy}
                    id="prepaid-deposit"
                    inputMode="decimal"
                    onChange={(e) => setDepositAmount(e.target.value)}
                    placeholder="0.0 LCAI"
                    value={depositAmount}
                  />
                  <Button
                    className="shrink-0"
                    disabled={
                      busy || !depositAmount || Number(depositAmount) <= 0
                    }
                    onClick={onDeposit}
                  >
                    {pb.depositAndAuthorizeMutation.isPending ? (
                      <Loader2Icon className="size-4 animate-spin" />
                    ) : (
                      "Deposit"
                    )}
                  </Button>
                </div>
              </div>

              <div>
                <label
                  className="mb-1.5 block text-content-soft text-sm"
                  htmlFor="prepaid-withdraw"
                >
                  Withdraw to wallet
                </label>
                <p className="mb-2 text-content-light text-xs">
                  Revoke the delegate first if you want to avoid pending prompts
                  debiting your balance before withdrawal confirms.
                </p>
                <div className="flex gap-2">
                  <Input
                    disabled={busy || pb.balance === 0n}
                    id="prepaid-withdraw"
                    inputMode="decimal"
                    onChange={(e) => setWithdrawAmount(e.target.value)}
                    placeholder="0.0 LCAI"
                    value={withdrawAmount}
                  />
                  <Button
                    className="shrink-0"
                    disabled={
                      busy ||
                      pb.balance === 0n ||
                      !withdrawAmount ||
                      Number(withdrawAmount) <= 0
                    }
                    onClick={onWithdraw}
                    variant="outline"
                  >
                    {pb.withdrawMutation.isPending ? (
                      <Loader2Icon className="size-4 animate-spin" />
                    ) : (
                      "Withdraw"
                    )}
                  </Button>
                </div>
                {pb.balance > 0n && (
                  <button
                    className="mt-1.5 text-content-light text-xs underline hover:text-content-soft"
                    disabled={busy}
                    onClick={() => setWithdrawAmount(balanceLCAI)}
                    type="button"
                  >
                    Withdraw all ({balanceLCAI} LCAI)
                  </button>
                )}
              </div>

              <div className="flex items-center justify-between border-bdr-light border-t pt-4">
                <div>
                  <p className="text-content-default text-sm">
                    {pb.isAuthorized
                      ? "Delegate is authorized"
                      : "Delegate not authorized"}
                  </p>
                  <p className="text-content-light text-xs">
                    {pb.isAuthorized
                      ? "Revoke to require a wallet signature per prompt again."
                      : showAuthorize
                        ? "Authorize so the API can submit prompts within your spending limit."
                        : "Your first deposit authorizes the delegate in the same transaction."}
                  </p>
                </div>
                {/* Deliberately no Authorize button at a zero balance. It would
                    authorize with no allowance, leaving prompts still gated,
                    and the deposit above already authorizes as part of the same
                    transaction — so offering it here costs a confirmation and
                    buys nothing. */}
                {(pb.isAuthorized || showAuthorize) && (
                  <Button
                    className="shrink-0"
                    disabled={busy}
                    onClick={onToggleDelegate}
                    variant={pb.isAuthorized ? "outline" : "default"}
                  >
                    {pb.authorizeMutation.isPending ||
                    pb.revokeMutation.isPending ? (
                      <Loader2Icon className="size-4 animate-spin" />
                    ) : pb.isAuthorized ? (
                      "Revoke"
                    ) : (
                      "Authorize"
                    )}
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <p className="text-content-soft text-sm">
              Prepaid balance isn&apos;t available on this network yet.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
