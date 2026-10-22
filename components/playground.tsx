"use client";

import {
  Lightchain,
  type LightchainJob,
  type LightchainOptions,
} from "@lightchainai/sdk";
import {
  CheckCircle2,
  ExternalLink,
  FlaskConical,
  Loader2,
  PlayCircle,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { type ReactNode, useState } from "react";
import useSWR from "swr";
import { custom, keccak256, toBytes } from "viem";
import { useAccount, useSwitchChain } from "wagmi";
import { ConnectWalletButton } from "@/components/connect-wallet-button";
import { ErrorNote, SnippetTabs } from "@/components/developer-api-panel";
import { Response } from "@/components/elements/response";
import { PrepaidBalanceDialog } from "@/components/prepaid-balance-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import config, { isTestnet } from "@/config";
import { useChatModels } from "@/hooks/use-models";
import usePrepaidBalance from "@/hooks/use-prepaid-balance";
import {
  type CompletionRequest,
  completionBody,
  EXAMPLE_REQUEST,
  publicApiUrl,
  usageSnippets,
} from "@/lib/api-keys";
import { explorerTxUrl, workerExplorerUrl } from "@/lib/explorer";
import { formatLcai } from "@/lib/lcai";
import {
  type Failure,
  priceOf,
  proofOf,
  responseFailure,
  type Step,
  thrownFailure,
} from "@/lib/playground";
import { GatewayClient } from "@/lib/protocol/gateway-client";
import { cn } from "@/lib/utils";

const FAUCET_URL = "https://lightfaucet.ai/";
const DEFAULT_PROMPT = "Reply with a one-sentence fun fact about the ocean.";
// ponytail: one cap for every model; the wallet shows each payment's
// maxAmount before it signs, so the cap only stops a runaway price.
const MAX_PAYMENT_WEI = 10n ** 18n;

const chain = config.chains[0];
const networkName = isTestnet ? "testnet" : "mainnet";
// This build's own endpoints, so a devnet build pays its own API.
const network = {
  chainId: chain.id,
  apiUrl: publicApiUrl,
  rpcUrl: chain.rpcUrls.default.http[0],
  jobRegistry: config.jobRegistryAddress[chain.id],
};

const STEPS: { id: Step; label: string }[] = [
  { id: "price", label: "Ask the Developer API for the price" },
  { id: "sign", label: "Sign the payment in your wallet" },
  { id: "run", label: "Run the job on chain" },
];

type Run = {
  step: Step | "done";
  failed?: Failure;
  /** What the 402 asked for, in wei. */
  price?: bigint;
  /** What the settlement debited, in wei. */
  paid?: bigint;
  answer?: string;
  proof?: LightchainJob | null;
};

/**
 * The models the Developer API serves, as GET /v1/models lists them, which
 * takes a key: the chat's live ones whose name is their id's and whose
 * workers declare self-contained. Fails open per model, as the API does.
 */
function useServedModels() {
  const { models } = useChatModels();
  const served = useSWR(
    models.length ? ["playground-models", ...models.map((m) => m.id)] : null,
    async () => {
      const gateway = new GatewayClient();
      const named = models.filter(
        (m) => keccak256(toBytes(m.name)) === m.id.toLowerCase()
      );
      const declared = await Promise.all(
        named.map((m) =>
          gateway.getModelCapabilities(m.id).then(
            (c) => c.capabilities.includes("self-contained"),
            () => true
          )
        )
      );
      return named.filter((_, i) => declared[i]).map((m) => m.name);
    },
    { revalidateOnFocus: false }
  );
  return served.data;
}

/**
 * One question, one answer, paid per call from the visitor's prepaid balance
 * through the SDK: one wallet signature, no gas. Layout after the community
 * LightNode playground (MIT).
 */
export function Playground() {
  const { address, chainId, connector, isConnected } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const pb = usePrepaidBalance();
  const models = useServedModels();
  const [model, setModel] = useState(EXAMPLE_REQUEST.model);
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [depositOpen, setDepositOpen] = useState(false);
  const [run, setRun] = useState<Run | null>(null);

  const balance = pb.queries.onChainBalance.data;
  const empty = isConnected && balance === 0n;
  const running = !!run && run.step !== "done" && !run.failed;
  // The picked model while it is served, else the first one that is.
  const served = models?.includes(model) ? model : models?.[0];

  const start = async () => {
    if (!(address && connector && served)) return;
    const request = { model: served, prompt };
    let step: Step = "price";
    let paid: bigint | undefined;
    const show = (next: Partial<Run>) =>
      setRun((current) => ({ step, ...current, ...next }));
    setRun({ step });
    try {
      // Wallets refuse to sign typed data for another chain than their own.
      if (chainId !== chain.id) await switchChainAsync({ chainId: chain.id });
      const provider = await connector.getProvider();
      const lc = new Lightchain({
        network,
        payment: "per-call",
        account: { address, type: "json-rpc" },
        // The SDK brings its own, newer viem; a transport is the same
        // function to both, only their types differ.
        transport: custom(
          provider as Parameters<typeof custom>[0]
        ) as unknown as LightchainOptions["transport"],
        maxPaymentWei: MAX_PAYMENT_WEI,
        onPayment: (payment) => {
          paid = payment.amount;
        },
        // Sees the SDK's two requests: the unpaid one, and the paid retry.
        fetch: async (input, init) => {
          const paying = new Headers(init?.headers).has("payment-signature");
          if (paying) {
            step = "run";
            show({ step });
          }
          const response = await fetch(input, init);
          if (!paying && response.status === 402) {
            const body = await response
              .clone()
              .json()
              .catch(() => null);
            step = "sign";
            show({ step, price: priceOf(body) });
          }
          return response;
        },
      });
      const response = await lc.fetch(`${lc.baseURL}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(completionBody(request)),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        show({ failed: responseFailure(response.status, body) });
        return;
      }
      show({
        step: "done",
        paid,
        answer: body?.choices?.[0]?.message?.content ?? "",
        proof: proofOf(response.headers.get("x-lightchain")),
      });
    } catch (error) {
      show({ failed: { message: thrownFailure(error, step) } });
    } finally {
      pb.refetch();
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8">
      <header>
        <span className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 font-medium text-primary text-xs">
          <FlaskConical className="size-3.5" />
          {isTestnet ? "Testnet" : "Mainnet"}
        </span>
        <h1 className="font-semibold text-2xl text-content-strong">
          Playground
        </h1>
        <p className="mt-1 max-w-2xl text-content-default text-sm">
          Ask one question through the Developer API and see the job it ran on
          chain. Each run is paid from your prepaid balance with one wallet
          signature and no gas.
        </p>
      </header>

      <section
        aria-label="Network and wallet"
        className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-bdr-light bg-surface-base-faint/60 px-6 py-4"
      >
        <div className="flex flex-col gap-1 text-sm">
          <p className="text-content-default">
            {chain.name} · chain {chain.id}
          </p>
          {isTestnet && (
            <p className="text-content-soft text-xs">
              Testnet LCAI is free:{" "}
              <ExternalAnchor href={FAUCET_URL}>
                get some from the faucet
              </ExternalAnchor>
              .
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-4">
          {isConnected && (
            <div>
              <p className="text-content-soft text-xs">Prepaid balance</p>
              <p className="font-medium text-content-strong text-sm tabular-nums">
                {balance === undefined ? "…" : formatLcai(balance)}
              </p>
            </div>
          )}
          {isConnected && (
            <Button
              onClick={() => setDepositOpen(true)}
              size="sm"
              type="button"
              variant="outline"
            >
              Top up
            </Button>
          )}
          <ConnectWalletButton className="px-4 py-2 text-sm" />
        </div>
      </section>

      {empty && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/5 px-6 py-4">
          <p className="max-w-xl text-content-default text-sm">
            Your prepaid balance is empty, and each run is paid from it. Deposit
            some LCAI first.
          </p>
          <Button onClick={() => setDepositOpen(true)} type="button">
            Deposit
          </Button>
        </div>
      )}

      <section
        aria-label="Request"
        className="flex flex-col gap-4 rounded-2xl border border-bdr-light px-6 py-5"
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="playground-model">Model</Label>
          <Select
            disabled={running}
            onValueChange={setModel}
            value={served ?? ""}
          >
            <SelectTrigger className="sm:w-72" id="playground-model">
              <SelectValue
                placeholder={
                  models ? "No model is served right now" : "Loading models…"
                }
              />
            </SelectTrigger>
            <SelectContent>
              {(models ?? []).map((name) => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="playground-prompt">Prompt</Label>
          <Textarea
            disabled={running}
            id="playground-prompt"
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Ask the model anything"
            rows={3}
            value={prompt}
          />
          <p className="text-content-soft text-xs">
            One question, one answer: a run keeps no history.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3">
          {isConnected ? (
            empty ? (
              <Button onClick={() => setDepositOpen(true)} type="button">
                Deposit first
              </Button>
            ) : (
              <Button
                disabled={running || !served || !prompt.trim()}
                onClick={start}
                type="button"
              >
                {running ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <PlayCircle />
                )}
                {running ? "Running…" : "Run"}
              </Button>
            )
          ) : (
            <ConnectWalletButton className="px-4 py-2 text-sm" />
          )}
        </div>
      </section>

      {run && <Progress onDeposit={() => setDepositOpen(true)} run={run} />}

      {run?.step === "done" && (
        <section
          aria-labelledby="playground-answer"
          className="flex flex-col gap-3 rounded-2xl border border-bdr-light px-6 py-5"
        >
          <h2
            className="font-semibold text-content-strong text-lg"
            id="playground-answer"
          >
            Answer
          </h2>
          <div className="text-content-default text-sm">
            {run.answer ? (
              <Response>{run.answer}</Response>
            ) : (
              <p className="text-content-soft">The model answered nothing.</p>
            )}
          </div>
        </section>
      )}

      {run?.proof && <Proofs paid={run.paid} proof={run.proof} />}

      <CodeBox request={{ model: served ?? model, prompt }} />

      <PrepaidBalanceDialog onOpenChange={setDepositOpen} open={depositOpen} />
    </div>
  );
}

function ExternalAnchor({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <a
      className="inline-flex items-center gap-1 text-primary hover:underline"
      href={href}
      rel="noopener noreferrer"
      target="_blank"
    >
      {children}
      <ExternalLink className="size-3" />
    </a>
  );
}

/** The step list, with the failure under it in words. */
function Progress({ run, onDeposit }: { run: Run; onDeposit: () => void }) {
  const at = STEPS.findIndex((s) => s.id === run.step);
  return (
    <section
      aria-labelledby="playground-progress"
      className="flex flex-col gap-3 rounded-2xl border border-bdr-light px-6 py-5"
    >
      <h2
        className="font-semibold text-content-strong text-lg"
        id="playground-progress"
      >
        Progress
      </h2>
      <ol aria-live="polite" className="flex flex-col gap-2.5">
        {STEPS.map((step, i) => {
          const status =
            run.step === "done" || i < at
              ? "done"
              : i > at
                ? "pending"
                : run.failed
                  ? "failed"
                  : "active";
          return (
            <li className="flex items-center gap-3 text-sm" key={step.id}>
              <StepIcon status={status} />
              <span
                className={cn(
                  status === "pending"
                    ? "text-content-soft"
                    : "text-content-default",
                  status === "active" && "font-medium text-content-strong",
                  status === "failed" && "font-medium text-content-error-light"
                )}
              >
                {step.label}
                {step.id === "price" && run.price !== undefined && (
                  <span className="text-content-soft">
                    {" "}
                    · {formatLcai(run.price)}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ol>
      {run.failed && (
        <ErrorNote>
          <span className="flex flex-1 flex-wrap items-center justify-between gap-3">
            {run.failed.message}
            {run.failed.deposit && (
              <Button onClick={onDeposit} size="sm" type="button">
                Deposit
              </Button>
            )}
          </span>
        </ErrorNote>
      )}
    </section>
  );
}

function StepIcon({
  status,
}: {
  status: "pending" | "active" | "done" | "failed";
}) {
  const ring = "grid size-6 shrink-0 place-items-center rounded-full";
  if (status === "done") {
    return (
      <span className={cn(ring, "bg-emerald-500/10 text-emerald-500")}>
        <CheckCircle2 className="size-3.5" />
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span
        className={cn(
          ring,
          "bg-surface-base-error-default/10 text-content-error-light"
        )}
      >
        <XCircle className="size-3.5" />
      </span>
    );
  }
  if (status === "active") {
    return (
      <span className={cn(ring, "bg-primary/10 text-primary")}>
        <Loader2 className="size-3.5 animate-spin" />
      </span>
    );
  }
  return <span className={cn(ring, "border border-bdr-light")} />;
}

/** The job behind the answer, from the response's x-lightchain header. */
function Proofs({ proof, paid }: { proof: LightchainJob; paid?: bigint }) {
  const rows: [string, ReactNode][] = [
    ["Job", proof.job_id],
    ["Session", proof.session_id],
    [
      "Submit transaction",
      <ExternalAnchor href={explorerTxUrl(proof.tx_hash)} key="tx">
        <span className="break-all font-mono">{proof.tx_hash}</span>
      </ExternalAnchor>,
    ],
    [
      "Worker",
      <ExternalAnchor
        href={workerExplorerUrl(proof.worker, networkName)}
        key="worker"
      >
        <span className="break-all font-mono">{proof.worker}</span>
      </ExternalAnchor>,
    ],
  ];
  if (paid !== undefined) rows.push(["Fee paid", formatLcai(paid)]);
  return (
    <section
      aria-labelledby="playground-proofs"
      className="flex flex-col gap-3 rounded-2xl border border-bdr-light bg-surface-base-faint/60 px-6 py-5"
    >
      <h2
        className="font-semibold text-content-strong text-lg"
        id="playground-proofs"
      >
        On chain
      </h2>
      <dl className="grid gap-2 text-sm sm:grid-cols-[10rem_1fr]">
        {rows.map(([term, value]) => (
          <div className="contents" key={term}>
            <dt className="text-content-soft">{term}</dt>
            <dd className="min-w-0 text-content-default">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** The run as code with an API key: the same endpoint and request body. */
function CodeBox({ request }: { request: CompletionRequest }) {
  const snippets = usageSnippets(publicApiUrl, networkName, request);

  return (
    <section aria-labelledby="playground-code" className="flex flex-col gap-4">
      <div>
        <h2
          className="font-semibold text-content-strong text-lg"
          id="playground-code"
        >
          The same call in code
        </h2>
        <p className="mt-1 max-w-2xl text-content-default text-sm">
          From a terminal or a server, the call authenticates with an API key in{" "}
          <code className="font-mono text-xs">$LIGHTCHAIN_API_KEY</code> and
          pays from the same prepaid balance. A run here pays with a single-use
          signature instead, so it can&apos;t be replayed.{" "}
          <Link className="text-primary hover:underline" href="/developer">
            Create a key
          </Link>
          .
        </p>
      </div>
      <SnippetTabs
        tabs={[
          { id: "curl", label: "curl", language: "bash", code: snippets.curl },
          {
            id: "lightchain",
            label: "@lightchainai/sdk",
            language: "typescript",
            code: snippets.lightchain,
          },
        ]}
      />
    </section>
  );
}
