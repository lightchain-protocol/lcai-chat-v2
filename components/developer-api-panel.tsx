"use client";

import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { useSession } from "next-auth/react";
import { type FormEvent, type ReactNode, useState } from "react";
import { toast } from "sonner";
import useSWR, { type KeyedMutator } from "swr";
import { formatEther } from "viem";
import { useAccount } from "wagmi";
import { ConnectWalletButton } from "@/components/connect-wallet-button";
import {
  CodeBlock,
  CodeBlockCopyButton,
} from "@/components/elements/code-block";
import { PrepaidBalanceDialog } from "@/components/prepaid-balance-dialog";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { isTestnet } from "@/config";
import usePrepaidBalance, { PREPAID_NOTICE } from "@/hooks/use-prepaid-balance";
import {
  type ApiKey,
  type CreateKeyForm,
  capStopsKey,
  createApiKey,
  deleteApiKey,
  listApiKeys,
  revokeApiKey,
  setSpendCap,
  spendCapOf,
  toCreateKeyBody,
  usageSnippets,
} from "@/lib/api-keys";
import { formatLcai } from "@/lib/lcai";
import { cn } from "@/lib/utils";
import AlertError from "./ui/toast/AlertError";
import AlertSuccess from "./ui/toast/AlertSuccess";

type MintedKey = ApiKey & { key: string };

/** How prose names a key: its name, or its prefix when it has none. */
function titleOf(key: ApiKey): string {
  return key.name ? `“${key.name}”` : `${key.prefix}…`;
}

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * The Developer API page: the prepaid balance API calls are paid from, the
 * wallet's API keys (mint, list, cap, revoke, delete) and how to call the API
 * with one.
 */
export function DeveloperApiPanel() {
  // Keyed by wallet: sign-out is a soft refresh, and the cache outlives it.
  const wallet = useSession().data?.user?.walletAddress;
  const keys = useSWR(wallet ? ["/api/api-keys", wallet] : null, () =>
    listApiKeys()
  );
  const [creating, setCreating] = useState(false);
  const [minted, setMinted] = useState<MintedKey | null>(null);
  const active = keys.data?.filter((key) => !key.revokedAt).length;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-4 py-8">
      <header>
        <h1 className="flex items-center gap-2 font-semibold text-2xl text-content-strong">
          <KeyRound className="size-6 text-content-soft" />
          Developer API
        </h1>
        <p className="mt-1 max-w-2xl text-content-default text-sm">
          Call the network from your own code with any OpenAI SDK. Each
          completion runs as a job on chain and is paid from your prepaid
          balance, the same one your chats use.
        </p>
      </header>

      <BalanceSummary />

      <section
        aria-labelledby="api-keys-heading"
        className="flex flex-col gap-4"
      >
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2
              className="font-semibold text-content-strong text-lg"
              id="api-keys-heading"
            >
              API keys
            </h2>
            <p className="max-w-2xl text-content-default text-sm">
              {active === undefined ? "" : `${active} active. `}
              Keys authenticate /v1 calls and spend from this wallet. Every key
              gets the server&apos;s rate and concurrency limits.
            </p>
          </div>
          {/* Hidden while a minted key shows, so nothing hides it unsaved,
              and on an empty list, which has a Create button of its own. */}
          {!creating && !minted && keys.data?.length !== 0 && (
            <Button onClick={() => setCreating(true)} type="button">
              <Plus />
              Create key
            </Button>
          )}
        </div>

        {minted && (
          <MintedKeyNotice minted={minted} onDone={() => setMinted(null)} />
        )}

        {creating && (
          <CreateKeyPanel
            onCancel={() => setCreating(false)}
            onCreated={(key) => {
              setCreating(false);
              setMinted(key);
              keys.mutate();
            }}
          />
        )}

        <KeyList
          data={keys.data}
          error={keys.error as Error | undefined}
          mutate={keys.mutate}
          onCreate={creating || minted ? undefined : () => setCreating(true)}
        />
      </section>

      <UsageSnippet />
    </div>
  );
}

/** The prepaid balance and delegate that pay for API calls, with a top-up. */
function BalanceSummary() {
  const { isConnected } = useAccount();
  const pb = usePrepaidBalance();
  const [open, setOpen] = useState(false);

  if (!isConnected) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-bdr-light bg-surface-base-faint/60 px-6 py-5">
        <p className="max-w-md text-content-default text-sm">
          Connect your wallet to see the prepaid balance your API calls are paid
          from.
        </p>
        <ConnectWalletButton className="px-4 py-2 text-sm" />
      </div>
    );
  }

  if (pb.status !== "available") {
    if (pb.status === "loading") {
      return <Skeleton className="h-[7.5rem] rounded-2xl" />;
    }
    return (
      <div className="rounded-2xl border border-bdr-light bg-surface-base-faint/60 px-6 py-5 text-content-default text-sm">
        {PREPAID_NOTICE[pb.status]}
      </div>
    );
  }

  const hint = pb.isLoading
    ? "…"
    : pb.ready
      ? "API calls are paid from this balance through the delegate."
      : pb.balance === 0n
        ? "Top up to pay for API calls. Until then, completions answer 402."
        : pb.isAuthorized
          ? "The delegate's spending limit is used up. Top up to raise it."
          : "Authorize the delegate so the API can submit jobs for your keys.";

  return (
    <section
      aria-label="Prepaid balance"
      className="flex flex-col gap-4 rounded-2xl border border-bdr-light bg-surface-base-faint/60 px-6 py-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Wallet className="size-5" />
          </div>
          <div>
            <p className="text-content-soft text-xs">Prepaid balance</p>
            <p
              className="font-semibold text-content-strong text-xl tabular-nums"
              data-testid="developer-balance"
            >
              {pb.isLoading ? "…" : formatLcai(pb.balance)}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div>
            <p className="text-content-soft text-xs">Delegate</p>
            <span
              className={cn(
                "mt-0.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs",
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
          {pb.isAuthorized && (
            <div>
              <p className="text-content-soft text-xs">Spending limit</p>
              <p className="font-medium text-content-default text-sm tabular-nums">
                {formatLcai(pb.allowance)}
              </p>
            </div>
          )}
          <Button onClick={() => setOpen(true)} type="button">
            Top up
          </Button>
        </div>
      </div>
      <p className="text-content-soft text-xs">{hint}</p>
      <PrepaidBalanceDialog onOpenChange={setOpen} open={open} />
    </section>
  );
}

function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <p
      className="flex items-start gap-2 rounded-[10px] bg-surface-base-error-default/10 px-3 py-2 text-content-error-light text-sm"
      role="alert"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      {children}
    </p>
  );
}

/**
 * A key's lifetime cap: an amount in LCAI, or Unlimited. Unlimited is its
 * own switch, so an empty amount never means "no cap" by accident.
 */
function SpendCapField({
  id,
  lcai,
  unlimited,
  disabled,
  onChange,
}: {
  id: string;
  lcai: string;
  unlimited: boolean;
  disabled: boolean;
  onChange: (cap: { lcai: string; unlimited: boolean }) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>Lifetime spend cap</Label>
      <div className="flex items-center gap-4">
        <div className="relative flex-1">
          <Input
            aria-describedby={`${id}-hint`}
            className="pr-14"
            disabled={disabled || unlimited}
            id={id}
            inputMode="decimal"
            onChange={(event) =>
              onChange({ lcai: event.target.value, unlimited })
            }
            placeholder={unlimited ? "Unlimited" : "1"}
            value={unlimited ? "" : lcai}
          />
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-content-soft text-sm">
            LCAI
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Switch
            checked={unlimited}
            disabled={disabled}
            id={`${id}-unlimited`}
            onCheckedChange={(checked) =>
              onChange({ lcai, unlimited: checked })
            }
          />
          <Label className="font-normal" htmlFor={`${id}-unlimited`}>
            Unlimited
          </Label>
        </div>
      </div>
      <p className="text-content-soft text-xs" id={`${id}-hint`}>
        The most this key may ever spend. You can change it later.
      </p>
    </div>
  );
}

const EMPTY_FORM: CreateKeyForm = {
  name: "",
  spendCapLcai: "",
  unlimited: false,
};

function CreateKeyPanel({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: (key: MintedKey) => void;
}) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting) {
      return;
    }
    const request = toCreateKeyBody(form);
    if ("error" in request) {
      setError(request.error);
      return;
    }
    setSubmitting(true);
    setError(null);
    const result = await createApiKey(request.body);
    setSubmitting(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    onCreated(result.created);
  };

  return (
    <form
      aria-labelledby="create-key-heading"
      className="rounded-2xl border border-bdr-light bg-surface-base-faint/40 p-5 sm:p-6"
      noValidate
      onSubmit={submit}
    >
      <h3 className="font-medium text-content-strong" id="create-key-heading">
        New API key
      </h3>

      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="key-name">Name</Label>
          <Input
            aria-describedby="key-name-hint"
            autoFocus
            disabled={submitting}
            id="key-name"
            maxLength={64}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            placeholder="backend-prod"
            required
            value={form.name}
          />
          <p className="text-content-soft text-xs" id="key-name-hint">
            A label for you, such as the app or environment.
          </p>
        </div>
        <SpendCapField
          disabled={submitting}
          id="key-cap"
          lcai={form.spendCapLcai}
          onChange={({ lcai, unlimited }) =>
            setForm({ ...form, spendCapLcai: lcai, unlimited })
          }
          unlimited={form.unlimited}
        />
      </div>

      {error && (
        <div className="mt-5">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      <div className="mt-6 flex justify-end gap-2">
        <Button
          disabled={submitting}
          onClick={onCancel}
          type="button"
          variant="outline"
        >
          Cancel
        </Button>
        <Button disabled={submitting} type="submit">
          {submitting && <Loader2 className="animate-spin" />}
          Create key
        </Button>
      </div>
    </form>
  );
}

/** The minted key, shown this once: the server never answers it again. */
function MintedKeyNotice({
  minted,
  onDone,
}: {
  minted: MintedKey;
  onDone: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(minted.key);
      setCopied(true);
    } catch {
      toast.custom((id) => (
        <AlertError
          description="Select the key and copy it yourself."
          id={id}
          title="Couldn't copy the key"
        />
      ));
    }
  };

  return (
    <section
      aria-labelledby="minted-key-heading"
      className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-5 sm:p-6"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-500" />
        <div className="min-w-0 flex-1">
          <h3
            className="font-medium text-content-strong"
            id="minted-key-heading"
          >
            Copy {titleOf(minted)} now
          </h3>
          <p className="mt-1 text-content-default text-sm">
            You won&apos;t see it again. Only a hash of it is stored, so a lost
            key can&apos;t be recovered: revoke it and create another. Keep it
            server-side, like a password.
          </p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <code
              className="min-w-0 flex-1 select-all break-all rounded-[10px] border border-bdr-light bg-surface-base-subtle px-3 py-2.5 font-mono text-content-strong text-sm"
              data-testid="minted-key"
            >
              {minted.key}
            </code>
            <Button
              // The form that minted it is gone; land keyboard users here.
              autoFocus
              className="shrink-0"
              onClick={copy}
              type="button"
              variant="outline"
            >
              {copied ? <Check /> : <Copy />}
              {copied ? "Copied" : "Copy key"}
            </Button>
          </div>
          <div className="mt-4 flex justify-end">
            <Button onClick={onDone} type="button">
              I&apos;ve saved it
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

/** Changes an active key's cap; warns when the new one stops it at once. */
function EditSpendCapDialog({
  apiKey,
  onClose,
  onSaved,
}: {
  apiKey: ApiKey;
  onClose: () => void;
  onSaved: (key: ApiKey) => void;
}) {
  const [cap, setCap] = useState(() => ({
    lcai: apiKey.spendCapWei ? formatEther(BigInt(apiKey.spendCapWei)) : "",
    unlimited: apiKey.spendCapWei === null,
  }));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const spent = BigInt(apiKey.spentWei);
  const chosen = spendCapOf(cap);
  const stopsAtOnce =
    "capWei" in chosen && capStopsKey(chosen.capWei, apiKey.spentWei);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) {
      return;
    }
    if ("error" in chosen) {
      setError(chosen.error);
      return;
    }
    setSaving(true);
    setError(null);
    const result = await setSpendCap(apiKey.id, chosen.capWei);
    setSaving(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    onSaved(result.updated);
  };

  return (
    <Dialog onOpenChange={(open) => !open && !saving && onClose()} open>
      <DialogContent className="rounded-3xl! sm:max-w-md">
        <form noValidate onSubmit={save}>
          <DialogHeader>
            <DialogTitle className="text-content-strong">
              Spend cap for {titleOf(apiKey)}
            </DialogTitle>
            <DialogDescription className="text-content-default">
              It has spent {formatLcai(spent)} so far.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-5 flex flex-col gap-4">
            <SpendCapField
              disabled={saving}
              id="edit-cap"
              lcai={cap.lcai}
              onChange={setCap}
              unlimited={cap.unlimited}
            />
            {stopsAtOnce && (
              <output
                className="flex items-start gap-2 rounded-[10px] bg-amber-500/10 px-3 py-2 text-amber-500 text-sm"
                htmlFor="edit-cap"
              >
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                This key has already spent {formatLcai(spent)}. With this cap it
                stops at once.
              </output>
            )}
            {error && <ErrorNote>{error}</ErrorNote>}
          </div>

          <div className="mt-6 flex justify-end gap-2">
            <Button
              disabled={saving}
              onClick={onClose}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button disabled={saving} type="submit">
              {saving && <Loader2 className="animate-spin" />}
              Save cap
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const ROW_GRID =
  "md:grid md:grid-cols-[minmax(0,1.5fr)_minmax(0,1.7fr)_7rem_6rem] md:items-center md:gap-4";

/** What the confirmation asks: revoke an active key, or delete a revoked one. */
type Pending = { key: ApiKey; action: "revoke" | "delete" };

const CONFIRM = {
  revoke: {
    title: "Revoke",
    lead: "Calls made with",
    body: "are refused from now on. The key stays listed as revoked.",
    button: "Revoke key",
    done: "Key revoked",
    failed: "Key not revoked",
    run: revokeApiKey,
  },
  delete: {
    title: "Delete",
    lead: "The revoked key",
    body: "is removed from this list for good.",
    button: "Delete key",
    done: "Key deleted",
    failed: "Key not deleted",
    run: deleteApiKey,
  },
} as const;

function KeyList({
  data,
  error,
  mutate,
  onCreate,
}: {
  data: ApiKey[] | undefined;
  error: Error | undefined;
  mutate: KeyedMutator<ApiKey[]>;
  onCreate?: () => void;
}) {
  // Kept after closing, so the dialog's text holds through its exit animation.
  const [pending, setPending] = useState<Pending | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState<ApiKey | null>(null);
  const [busy, setBusy] = useState(false);
  const confirm = pending ? CONFIRM[pending.action] : null;

  const run = async () => {
    if (!pending || !confirm) {
      return;
    }
    setBusy(true);
    const { error: refused } = await confirm.run(pending.key.id);
    setBusy(false);
    setConfirming(false);
    if (refused) {
      toast.custom((id) => (
        <AlertError description={refused} id={id} title={confirm.failed} />
      ));
    } else {
      toast.custom((id) => <AlertSuccess id={id} title={confirm.done} />);
    }
    mutate();
  };

  if (error && !data) {
    return (
      <div
        className="flex flex-col items-center gap-3 rounded-2xl border border-bdr-light px-6 py-10 text-center"
        role="alert"
      >
        <p className="text-content-default text-sm">{error.message}</p>
        <Button
          onClick={() => mutate()}
          size="sm"
          type="button"
          variant="outline"
        >
          <RefreshCw />
          Try again
        </Button>
      </div>
    );
  }

  if (!data) {
    return (
      <div aria-busy="true" className="flex flex-col gap-2">
        <span className="sr-only">Loading API keys…</span>
        {[0, 1].map((row) => (
          <Skeleton className="h-16 rounded-2xl" key={row} />
        ))}
      </div>
    );
  }

  if (data.length === 0) {
    return onCreate ? (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-bdr-light border-dashed px-6 py-10 text-center">
        <KeyRound className="size-8 text-content-soft" />
        <div>
          <p className="font-medium text-content-strong">No API keys yet</p>
          <p className="mt-1 max-w-sm text-content-default text-sm">
            Create a key for each app or environment. Each one has its own spend
            cap and can be revoked on its own.
          </p>
        </div>
        <Button onClick={onCreate} type="button">
          <Plus />
          Create key
        </Button>
      </div>
    ) : null;
  }

  return (
    <>
      <div className="overflow-hidden rounded-2xl border border-bdr-light">
        <div
          aria-hidden
          className={cn(
            "hidden border-bdr-light border-b bg-surface-base-faint px-4 py-3 font-medium text-content-default text-xs",
            ROW_GRID
          )}
        >
          <span>Key</span>
          <span>Spent / cap</span>
          <span>Created</span>
          <span />
        </div>
        <ul className="divide-y divide-bdr-light">
          {data.map((key) => (
            <KeyRow
              apiKey={key}
              key={key.id}
              onAction={(action) => {
                setPending({ key, action });
                setConfirming(true);
              }}
              onEditCap={() => setEditing(key)}
            />
          ))}
        </ul>
      </div>

      {editing && (
        <EditSpendCapDialog
          apiKey={editing}
          onClose={() => setEditing(null)}
          onSaved={(updated) => {
            setEditing(null);
            mutate(
              (keys) =>
                keys?.map((key) => (key.id === updated.id ? updated : key)),
              { revalidate: false }
            );
            toast.custom((id) => (
              <AlertSuccess id={id} title="Spend cap updated" />
            ));
          }}
        />
      )}

      <AlertDialog
        onOpenChange={(open) => !open && !busy && setConfirming(false)}
        open={confirming}
      >
        <AlertDialogContent className="sm:rounded-3xl">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.title} {pending && titleOf(pending.key)}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.lead}{" "}
              <span className="font-mono">{pending?.key.prefix}…</span>{" "}
              {confirm?.body} This can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-surface-base-error-default hover:bg-surface-base-error-default/90"
              disabled={busy}
              onClick={(event) => {
                // Stay open until the server answers.
                event.preventDefault();
                run();
              }}
            >
              {busy && <Loader2 className="animate-spin" />}
              {confirm?.button}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function MobileLabel({ children }: { children: ReactNode }) {
  return (
    <span className="w-24 shrink-0 text-content-soft text-xs md:sr-only">
      {children}
    </span>
  );
}

function KeyRow({
  apiKey,
  onAction,
  onEditCap,
}: {
  apiKey: ApiKey;
  onAction: (action: Pending["action"]) => void;
  onEditCap: () => void;
}) {
  const spent = BigInt(apiKey.spentWei);
  const cap = apiKey.spendCapWei === null ? null : BigInt(apiKey.spendCapWei);
  const revoked = apiKey.revokedAt !== null;
  const label = apiKey.name ?? apiKey.prefix;

  return (
    <li
      className={cn("flex flex-col gap-2 px-4 py-3 text-sm", ROW_GRID)}
      data-testid="api-key-row"
    >
      <div className="min-w-0">
        <p
          className={cn(
            "truncate font-medium",
            revoked ? "text-content-soft" : "text-content-strong"
          )}
        >
          {apiKey.name ?? "Unnamed key"}
        </p>
        <p className="font-mono text-content-soft text-xs">{apiKey.prefix}…</p>
        {apiKey.revokedAt && (
          <p className="mt-1 text-content-soft text-xs">
            Revoked {formatDay(apiKey.revokedAt)}
          </p>
        )}
      </div>

      <div className="flex items-center md:block">
        <MobileLabel>Spent / cap</MobileLabel>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            <p className="text-content-default tabular-nums">
              {cap === null ? (
                <>
                  Unlimited
                  <span className="text-content-soft">
                    {" "}
                    · {formatLcai(spent)} spent
                  </span>
                </>
              ) : (
                <>
                  {formatLcai(spent)}
                  <span className="text-content-soft">
                    {" "}
                    / {formatLcai(cap)}
                  </span>
                </>
              )}
            </p>
            {!revoked && (
              <Button
                aria-label={`Edit the spend cap of ${label}`}
                className="h-7 px-1.5 text-content-soft hover:text-content-strong"
                onClick={onEditCap}
                size="sm"
                title="Edit spend cap"
                type="button"
                variant="ghost"
              >
                <Pencil className="size-3.5!" />
              </Button>
            )}
          </div>
          {cap !== null && cap > 0n && (
            <Progress
              aria-label="Share of the spend cap used"
              className="mt-1 h-1 bg-surface-base-faint"
              value={Math.min(100, Number((spent * 100n) / cap))}
            />
          )}
        </div>
      </div>

      <div className="flex items-center">
        <MobileLabel>Created</MobileLabel>
        <span className="text-content-default">
          {formatDay(apiKey.createdAt)}
        </span>
      </div>

      <div className="flex items-center md:justify-end">
        <Button
          aria-label={`${revoked ? "Delete" : "Revoke"} ${label}`}
          className="h-8 px-3 text-content-error-light text-xs hover:text-content-error-light"
          onClick={() => onAction(revoked ? "delete" : "revoke")}
          size="sm"
          type="button"
          variant="outline"
        >
          {revoked ? "Delete" : "Revoke"}
        </Button>
      </div>
    </li>
  );
}

const TRAILING_SLASHES = /\/+$/;

const SNIPPETS = [
  { id: "openai", label: "OpenAI SDK" },
  { id: "lightchain", label: "@lightchainai/sdk" },
] as const;

function UsageSnippet() {
  const [tab, setTab] = useState<(typeof SNIPPETS)[number]["id"]>("openai");
  // The public URL, not $http's: on the server that is the internal one.
  const baseUrl = (process.env.NEXT_PUBLIC_CONSUMER_API_URL ?? "").replace(
    TRAILING_SLASHES,
    ""
  );
  const snippets = usageSnippets(baseUrl, isTestnet ? "testnet" : "mainnet");

  return (
    <section aria-labelledby="usage-heading" className="flex flex-col gap-4">
      <div>
        <h2
          className="font-semibold text-content-strong text-lg"
          id="usage-heading"
        >
          Use a key
        </h2>
        <p className="mt-1 max-w-2xl text-content-default text-sm">
          The API is OpenAI-compatible: point any OpenAI SDK at{" "}
          <code className="rounded bg-surface-base-faint px-1 py-0.5 font-mono text-content-strong text-xs">
            {baseUrl}/v1
          </code>{" "}
          and pass the key. Or let{" "}
          <code className="font-mono text-xs">@lightchainai/sdk</code> supply
          the URL for the network.
        </p>
      </div>
      <div className="flex w-fit gap-1 rounded-[10px] border border-bdr-light p-1">
        {SNIPPETS.map((snippet) => (
          <button
            aria-pressed={tab === snippet.id}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
              tab === snippet.id
                ? "bg-surface-base-faint font-medium text-content-strong"
                : "text-content-soft hover:text-content-strong"
            )}
            key={snippet.id}
            onClick={() => setTab(snippet.id)}
            type="button"
          >
            {snippet.label}
          </button>
        ))}
      </div>
      <CodeBlock
        className="rounded-2xl border-bdr-light"
        code={snippets[tab]}
        language="typescript"
      >
        <CodeBlockCopyButton aria-label="Copy code" />
      </CodeBlock>
    </section>
  );
}
