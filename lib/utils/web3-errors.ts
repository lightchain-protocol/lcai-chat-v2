import { formatEther } from "viem";

/**
 * The native token symbol shown to users in error messages.
 * Kept as a constant (rather than reading per-chain config) so this module
 * stays free of React/chain context and is safe to call from anywhere.
 */
const NATIVE_SYMBOL = "LCAI";

// Hoisted regexes (recompiled per-call otherwise; this module is hot on errors).
const TRAILING_ZEROS_RE = /\.?0+$/;
const HAVE_WANT_RE = /have\s+(\d+)\s+want\s+(\d+)/i;
const REVERT_REASON_RE = /execution reverted:?\s*(.+?)(?:$|\n|"|\()/i;
const HEX_PREFIX_RE = /^0x/;
const ERR_PREFIX_RE = /^err:\s*/i;
const ERROR_PREFIX_RE = /^error:\s*/i;

/**
 * A user-friendly, two-part representation of a blockchain/RPC error.
 * `title` is a short, plain-language summary. `description` adds the
 * actionable detail (amounts, what to do next) when we have one.
 */
export type ParsedWeb3Error = {
  title: string;
  description?: string;
  /** The original, unmodified message — handy for logging/debugging. */
  raw: string;
};

/** Format a wei value (as string/bigint) into a trimmed token amount. */
function formatToken(weiLike: string | bigint): string {
  try {
    const wei = typeof weiLike === "bigint" ? weiLike : BigInt(weiLike);
    const ether = formatEther(wei);
    // Trim trailing zeros / dangling decimal point for readability.
    const trimmed = ether.includes(".")
      ? ether.replace(TRAILING_ZEROS_RE, "")
      : ether;
    return `${trimmed} ${NATIVE_SYMBOL}`;
  } catch {
    return `${weiLike} wei`;
  }
}

/**
 * Pull the deepest, most specific message out of a viem/wagmi/ethers error.
 * viem errors expose `.walk()` to reach the root cause; we also fall back to
 * common nested shapes (`cause`, `error.message`, `details`, `shortMessage`).
 */
function extractRawMessage(error: unknown): string {
  if (typeof error === "string") return error;

  const anyErr = error as {
    walk?: () => { shortMessage?: string; message?: string; details?: string };
    shortMessage?: string;
    details?: string;
    message?: string;
    error?: { message?: string };
    cause?: { message?: string; shortMessage?: string };
    reason?: string;
  } | null;

  if (!anyErr) return "Transaction failed";

  const walked = anyErr.walk?.();

  return (
    walked?.details ||
    walked?.shortMessage ||
    walked?.message ||
    anyErr.reason ||
    anyErr.details ||
    anyErr.shortMessage ||
    anyErr.cause?.shortMessage ||
    anyErr.cause?.message ||
    anyErr.error?.message ||
    anyErr.message ||
    "Transaction failed"
  );
}

/** Known error-name → friendly message mapping for our custom error classes. */
const NAMED_ERRORS: Record<string, ParsedWeb3Error> = {
  InsufficientPrepaidBalanceError: {
    title: "Not enough prepaid balance",
    description: "Top up your prepaid balance to keep sending prompts.",
    raw: "InsufficientPrepaidBalanceError",
  },
  DelegateNotAuthorizedError: {
    title: "Delegate not authorized",
    description:
      "Authorize the service to submit prompts on your behalf, then try again.",
    raw: "DelegateNotAuthorizedError",
  },
  ProtocolAuthExpiredError: {
    title: "Session expired",
    description: "Please sign in with your wallet again to continue.",
    raw: "ProtocolAuthExpiredError",
  },
};

/**
 * Turn a raw, low-level message into a friendly title + description.
 * Patterns are checked most-specific first.
 */
function matchPattern(raw: string): ParsedWeb3Error {
  const msg = raw.toLowerCase();

  // ── User rejected the request in their wallet ────────────────────────────
  if (
    msg.includes("user rejected") ||
    msg.includes("user denied") ||
    msg.includes("rejected the request") ||
    msg.includes("request rejected")
  ) {
    return {
      title: "Transaction cancelled",
      description: "You rejected the request in your wallet.",
      raw,
    };
  }

  // ── Insufficient funds for gas * price + value ───────────────────────────
  // e.g. "insufficient funds for gas * price + value: address 0x..
  //       have 0 want 1000000000000000000 (supplied gas 50000000)"
  if (msg.includes("insufficient funds")) {
    const haveWant = raw.match(HAVE_WANT_RE);
    if (haveWant) {
      const have = formatToken(haveWant[1]);
      const want = formatToken(haveWant[2]);
      return {
        title: `Not enough ${NATIVE_SYMBOL} to complete this transaction`,
        description: `This requires about ${want} (incl. gas) but your wallet only has ${have}. Add funds and try again.`,
        raw,
      };
    }
    return {
      title: `Not enough ${NATIVE_SYMBOL} to complete this transaction`,
      description: `Your wallet doesn't have enough ${NATIVE_SYMBOL} to cover the amount plus gas fees.`,
      raw,
    };
  }

  // ── Allowance / ERC-20 approval problems ─────────────────────────────────
  if (
    msg.includes("transfer amount exceeds allowance") ||
    msg.includes("insufficient allowance")
  ) {
    return {
      title: "Spending limit too low",
      description: `Approve a higher ${NATIVE_SYMBOL} spending limit, then try again.`,
      raw,
    };
  }
  if (msg.includes("transfer amount exceeds balance")) {
    return {
      title: `Not enough ${NATIVE_SYMBOL}`,
      description: `You don't have enough ${NATIVE_SYMBOL} for this transfer.`,
      raw,
    };
  }

  // ── Gas estimation / limits ──────────────────────────────────────────────
  if (
    msg.includes("gas required exceeds allowance") ||
    msg.includes("intrinsic gas too low") ||
    msg.includes("out of gas")
  ) {
    return {
      title: "Transaction needs more gas",
      description:
        "The gas limit was too low for this transaction. Try again, or raise the gas limit in your wallet.",
      raw,
    };
  }

  // ── Nonce / replacement issues ───────────────────────────────────────────
  if (msg.includes("nonce too low")) {
    return {
      title: "Transaction out of sync",
      description:
        "A pending transaction is ahead of this one. Wait for it to finish, or reset your wallet's account, then retry.",
      raw,
    };
  }
  if (
    msg.includes("replacement transaction underpriced") ||
    msg.includes("already known")
  ) {
    return {
      title: "Transaction already pending",
      description:
        "A similar transaction is already in progress. Wait for it to confirm before retrying.",
      raw,
    };
  }
  if (msg.includes("transaction underpriced") || msg.includes("fee too low")) {
    return {
      title: "Gas fee too low",
      description:
        "The network rejected the gas fee. Increase the fee in your wallet and try again.",
      raw,
    };
  }

  // ── Reverts ──────────────────────────────────────────────────────────────
  if (msg.includes("execution reverted") || msg.includes("reverted")) {
    // Try to surface a custom revert reason if present.
    const reason = raw.match(REVERT_REASON_RE)?.[1]?.trim();
    return {
      title: "Transaction rejected by the contract",
      description:
        reason && reason.length > 0 && !HEX_PREFIX_RE.test(reason)
          ? reason
          : "The contract refused this transaction. Check the inputs and your balance, then try again.",
      raw,
    };
  }

  // ── Network / connection ─────────────────────────────────────────────────
  if (
    msg.includes("network error") ||
    msg.includes("failed to fetch") ||
    msg.includes("timeout") ||
    msg.includes("connection")
  ) {
    return {
      title: "Network connection problem",
      description:
        "Couldn't reach the network. Check your connection and try again.",
      raw,
    };
  }

  if (msg.includes("chain mismatch") || msg.includes("wrong network")) {
    return {
      title: "Wrong network",
      description: "Switch your wallet to the correct network and try again.",
      raw,
    };
  }

  // ── Fallback: clean up the raw message a little ──────────────────────────
  const cleaned = raw
    .replace(ERR_PREFIX_RE, "")
    .replace(ERROR_PREFIX_RE, "")
    .trim();
  return {
    title: cleaned.length > 0 ? cleaned : "Transaction failed",
    raw,
  };
}

/**
 * Convert any blockchain/wallet/RPC error into a friendly, readable form.
 *
 * @example
 *   const { title, description } = parseWeb3Error(error);
 *   toast.custom((id) => <AlertError id={id} title={title} description={description} />);
 */
export function parseWeb3Error(error: unknown): ParsedWeb3Error {
  // Custom error classes carry a `.name` we map directly.
  const name = (error as { name?: string })?.name;
  if (name && NAMED_ERRORS[name]) {
    return NAMED_ERRORS[name];
  }

  const raw = extractRawMessage(error);
  return matchPattern(raw);
}

/**
 * Convenience for call sites that only need a single string (e.g. `toast.error`).
 * Combines title and description into one line.
 */
export function getWeb3ErrorMessage(error: unknown): string {
  const { title, description } = parseWeb3Error(error);
  return description ? `${title} — ${description}` : title;
}
