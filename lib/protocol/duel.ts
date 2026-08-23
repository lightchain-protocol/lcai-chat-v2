/**
 * Multi-model duel — orchestration rules and honest copy.
 *
 * Implements the frontend half of bc-2-duel-and-verifier-spec.md §1:
 *  - Funding precheck mirrors the contract's execution-time checks: a duel
 *    needs prepaid balance ≥ feeA + feeB AND delegate allowance ≥ the same,
 *    with the delegate authorized. Funding is amortized — no extra txs when
 *    the prepaid balance already covers both jobs.
 *  - Labels are honest about correlation: a same-model duel is "two runs of
 *    {model}" (same worker, possibly correlated outputs), never "A vs B".
 *  - Refund wording is per-job and names the prepaid balance, never the
 *    wallet — balance-funded refunds credit prepaidBalances (SettlementLib).
 */

export type DuelFundingInput = {
  isAuthorized: boolean;
  balanceWei: bigint;
  allowanceWei: bigint;
  feeWeiA: bigint;
  feeWeiB: bigint;
};

export type DuelFundingVerdict =
  | { ok: true; totalWei: bigint }
  | {
      ok: false;
      reason:
        | "not-authorized"
        | "insufficient-balance"
        | "insufficient-allowance";
      totalWei: bigint;
      availableWei: bigint;
    };

export function checkDuelFunding(input: DuelFundingInput): DuelFundingVerdict {
  const totalWei = input.feeWeiA + input.feeWeiB;
  if (!input.isAuthorized) {
    return { ok: false, reason: "not-authorized", totalWei, availableWei: 0n };
  }
  if (input.balanceWei < totalWei) {
    return {
      ok: false,
      reason: "insufficient-balance",
      totalWei,
      availableWei: input.balanceWei,
    };
  }
  // The known allowance-leak: refunds do not restore allowance, so after any
  // failed/timeout job in the session the delegate's budget has silently
  // shrunk by one fee — the allowance check is independent, not implied by
  // the balance check.
  if (input.allowanceWei < totalWei) {
    return {
      ok: false,
      reason: "insufficient-allowance",
      totalWei,
      availableWei: input.allowanceWei,
    };
  }
  return { ok: true, totalWei };
}

/** Honest duel heading (spec §1.6 failure-mode note on correlated runs). */
export function duelHeading(modelA: string, modelB: string): string {
  return modelA === modelB ? `Two runs of ${modelA}` : `${modelA} vs ${modelB}`;
}

export type DuelSideFailure = "submit-reverted" | "timeout" | "stream-error";

/**
 * Per-side failure copy (spec §1.6). The other side is always untouched;
 * refund language names the prepaid balance, and a timeout only refunds once
 * the timeout is actually claimed — so the unclaimed case says "reclaimable",
 * not "refunded".
 */
export function duelFailureCopy(failure: DuelSideFailure): string {
  switch (failure) {
    case "submit-reverted":
      return "This side's submission reverted before payment — no fee was escrowed. The other side is unaffected.";
    case "timeout":
      return "This side failed — claim the timeout to return the fee to your prepaid balance.";
    case "stream-error":
      return "This side's stream failed. If the job times out on chain, the fee returns to your prepaid balance.";
    default:
      // Unreachable per the DuelSideFailure union — kept so an unexpected
      // value fails with honest generic copy instead of `undefined`.
      return "This side failed. The other side is unaffected.";
  }
}

/** One-line summary when both sides fail (spec: one summary, not two popups). */
export const DUEL_BOTH_FAILED_COPY =
  "Both duel jobs failed. Each fee is independent — reclaim timeouts to return them to your prepaid balance.";

/**
 * Duel grouping metadata, carried in message.metadata.protocolMeta.duel.
 * The anchor user message (side "A", also records model A) and side B's
 * assistant answer share a group id — the anchor's message id — so the
 * message list can render them as one side-by-side block. Side A's own
 * assistant reply is found positionally (the reply right after the anchor),
 * which keeps the normal useChat path untouched.
 */
export type DuelMeta = {
  group: string;
  side: "A" | "B";
  /** Local friendly model id (e.g. "qwen3-8b") for this pane. */
  model: string;
};

/** Defensive read of protocolMeta.duel — persisted metadata is untrusted. */
export function getDuelMeta(message: { metadata?: unknown }): DuelMeta | null {
  const meta = (
    message.metadata as { protocolMeta?: Record<string, unknown> } | undefined
  )?.protocolMeta?.duel;
  if (!meta || typeof meta !== "object") {
    return null;
  }
  const d = meta as Record<string, unknown>;
  if (
    typeof d.group !== "string" ||
    (d.side !== "A" && d.side !== "B") ||
    typeof d.model !== "string"
  ) {
    return null;
  }
  return { group: d.group, side: d.side, model: d.model };
}
