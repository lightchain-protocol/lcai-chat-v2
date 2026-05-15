"use client";

import { Wallet } from "lucide-react";
import { useState } from "react";
import { useAccount } from "wagmi";
import { Button } from "@/components/ui/button";
import usePrepaidBalance from "@/hooks/use-prepaid-balance";
import { cn } from "@/lib/utils";
import { PrepaidBalanceDialog } from "./prepaid-balance-dialog";

const TRAILING_ZEROS = /0+$/;

function formatShortLCAI(wei: bigint): string {
  // Show up to 4 decimals, trimming trailing zeros.
  const whole = wei / 10n ** 18n;
  const frac = wei % 10n ** 18n;
  if (frac === 0n) return whole.toString();
  const fracStr = frac
    .toString()
    .padStart(18, "0")
    .slice(0, 4)
    .replace(TRAILING_ZEROS, "");
  return fracStr ? `${whole}.${fracStr}` : whole.toString();
}

/**
 * Chat-header pill showing the user's prepaid balance + delegate readiness.
 * Click opens the PrepaidBalanceDialog (deposit / withdraw / authorize).
 * Renders nothing when no wallet is connected or the feature isn't available.
 */
export function PrepaidBalanceButton({ className }: { className?: string }) {
  const { isConnected } = useAccount();
  const pb = usePrepaidBalance();
  const [open, setOpen] = useState(false);

  if (!isConnected || !pb.available) return null;

  const label = pb.isLoading ? "…" : `${formatShortLCAI(pb.balance)} LCAI`;

  return (
    <>
      <Button
        className={cn(
          "h-9 border-surface-base-extraLight bg-surface-base-faint px-2 text-content-default hover:bg-surface-base-extraLight",
          className
        )}
        onClick={() => setOpen(true)}
        title={
          pb.ready
            ? "Prepaid balance — prompts are gas-free"
            : "Set up a prepaid balance for gas-free prompts"
        }
        type="button"
        variant="outline"
      >
        <Wallet
          className={cn(
            "size-4.5!",
            pb.ready ? "text-emerald-500" : "text-content-soft"
          )}
        />
        <span className="hidden text-sm leading-0 md:inline">{label}</span>
      </Button>
      <PrepaidBalanceDialog onOpenChange={setOpen} open={open} />
    </>
  );
}
