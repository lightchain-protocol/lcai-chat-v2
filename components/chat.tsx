"use client";

import { useChat } from "@ai-sdk/react";
import { useAppKit } from "@reown/appkit/react";
import { type DataUIPart, DefaultChatTransport } from "ai";
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import useSWR, { useSWRConfig } from "swr";
import { unstable_serialize } from "swr/infinite";
import { useAccount, useBalance } from "wagmi";
import { ChatHeader } from "@/components/chat-header";
import type { PromptTemplate } from "@/components/system-prompt-selector";
import { useAutoResume } from "@/hooks/use-auto-resume";
import { useChatVisibility } from "@/hooks/use-chat-visibility";
import usePrepaidBalance from "@/hooks/use-prepaid-balance";
import { useModelCapabilities } from "@/hooks/use-model-capabilities";
import { useModels } from "@/hooks/use-models";
import { useProtocolSession } from "@/hooks/use-protocol-session";
import useWeb3Clients from "@/hooks/use-web3-clients";
import { saveChatModelAsCookie } from "@/app/(chat)/actions";
import { DEFAULT_CHAT_MODEL } from "@/lib/ai/models";
import type { Vote } from "@/lib/db/schema";
import { $http } from "@/lib/http";
import { ProtocolAuthExpiredError } from "@/lib/protocol/gateway-client";
import { NoWorkerAvailableError } from "@/lib/protocol/session";
import type { Attachment, ChatMessage, CustomUIDataTypes } from "@/lib/types";
import type { AppUsage } from "@/lib/usage";
import { parseWeb3Error } from "@/lib/utils/web3-errors";
import { fetcher, fetchWithErrorHandlers, generateUUID } from "@/lib/utils";
import {
  addMemoryEntry,
  EMPTY_MEMORY_STORE,
  loadMemoryStore,
  type MemoryStore,
  memoryPrefixFromStore,
  removeMemoryEntry,
  saveMemoryStore,
} from "@/lib/memory";
import { useDataStream } from "./data-stream-provider";
import { JobTimeoutToast } from "./job-timeout-toast";
import { MemoryDialog } from "./memory-dialog";
import { Messages } from "./messages";
import { MultimodalInput } from "./multimodal-input";
import { PrepaidBalanceDialog } from "./prepaid-balance-dialog";
import { SessionRecoveryBanner } from "./session-recovery-banner";
import { getChatHistoryPaginationKey } from "./sidebar-history";
import AlertError from "./ui/toast/AlertError";
import AlertInfo from "./ui/toast/AlertInfo";
import { UsageWarningBanner } from "./usage-warning-banner";
import type { VisibilityType } from "./visibility-selector";

function isProtocolAuthExpiredError(error: unknown): boolean {
  if (error instanceof ProtocolAuthExpiredError) {
    return true;
  }

  if (!(error instanceof Error)) {
    return false;
  }

  const candidate = error as {
    walk?: () => unknown;
    cause?: unknown;
  };
  const walkedError = candidate.walk?.();
  return (
    walkedError instanceof ProtocolAuthExpiredError ||
    candidate.cause instanceof ProtocolAuthExpiredError
  );
}

function isNoWorkerAvailableError(error: unknown): boolean {
  if (error instanceof NoWorkerAvailableError) {
    return true;
  }
  if (!(error instanceof Error)) {
    return false;
  }
  const candidate = error as { cause?: unknown };
  return candidate.cause instanceof NoWorkerAvailableError;
}

// Surface the thrown message itself: a capability-constrained timeout carries
// actionable copy ("… turn off web search") that a generic retry line hides.
function noWorkerAvailableMessage(error: unknown): string | undefined {
  if (error instanceof NoWorkerAvailableError) {
    return error.message || undefined;
  }
  if (error instanceof Error && error.cause instanceof NoWorkerAvailableError) {
    return error.cause.message || undefined;
  }
  return undefined;
}

const isProtocolMode = process.env.NEXT_PUBLIC_USE_PROTOCOL === "true";

export function Chat({
  id,
  initialMessages,
  initialChatModel,
  initialVisibilityType,
  isReadonly,
  autoResume,
  initialLastContext,
  initialSystemPrompt,
}: {
  id: string;
  initialMessages: ChatMessage[];
  initialChatModel: string;
  initialVisibilityType: VisibilityType;
  isReadonly: boolean;
  autoResume: boolean;
  initialLastContext?: AppUsage;
  initialSystemPrompt?: string | null;
}) {
  const { visibilityType } = useChatVisibility({
    chatId: id,
    initialVisibilityType,
  });

  const { mutate } = useSWRConfig();
  const { setDataStream } = useDataStream();
  const { status: sessionStatus, data } = useSession();
  const { open } = useAppKit();

  const [input, setInput] = useState<string>("");
  const [usage] = useState<AppUsage | undefined>(initialLastContext);
  const [currentModelId, setCurrentModelId] = useState(initialChatModel);
  const currentModelIdRef = useRef(currentModelId);

  // Live models are keyed by on-chain id (0x…hex); the initial/cookie value may
  // be a legacy name ("llama3-8b") or a model with no active worker, which the
  // picker can't resolve — leaving it showing "Select model". Auto-select an
  // available model (prefer DEFAULT_CHAT_MODEL by name, else the first one) so a
  // default is always chosen, like before the live-model picker landed.
  const { models: availableModels } = useModels();
  // Ref so the protocol fetch wrapper can name the serving model without
  // re-creating the transport whenever the live model list refreshes.
  const availableModelsRef = useRef(availableModels);
  useEffect(() => {
    availableModelsRef.current = availableModels;
  }, [availableModels]);
  useEffect(() => {
    if (availableModels.length === 0) {
      return;
    }
    if (availableModels.some((model) => model.id === currentModelId)) {
      return;
    }
    const fallback =
      availableModels.find((model) => model.name === DEFAULT_CHAT_MODEL) ??
      availableModels[0];
    setCurrentModelId(fallback.id);
    void saveChatModelAsCookie(fallback.id);
  }, [availableModels, currentModelId]);

  const [systemPromptId, setSystemPromptId] = useState<string>("default");
  const [systemPrompt, setSystemPrompt] = useState<string | null>(
    initialSystemPrompt || null,
  );
  const systemPromptRef = useRef(systemPrompt);

  const [enableWebSearch, setEnableWebSearch] = useState(false);
  const enableWebSearchRef = useRef(enableWebSearch);
  const { walletClient } = useWeb3Clients();
  const { address, isConnected } = useAccount();
  const balance = useBalance({ address });

  // Pre-send gate: a prompt only produces a response when the user has a
  // connected wallet AND a usable prepaid balance (funded, delegate authorized,
  // allowance available). Otherwise the on-chain prompt is accepted but never
  // answered. This dialog is the existing deposit/authorize modal, opened on a
  // blocked send.
  const [prepaidGateOpen, setPrepaidGateOpen] = useState(false);

  // When the user has a funded prepaid balance + authorized delegate, route
  // prompts through the consumer-api (no per-prompt wallet TX). "auto" so a
  // stale read or a balance dip falls back to the wallet path gracefully.
  const prepaid = usePrepaidBalance();
  const submitMode = "auto"; // prepaid.ready ? "auto" : "wallet";

  // Guard run before every user-initiated send. Returns false (and surfaces the
  // appropriate modal) when the prompt can't be answered:
  //   - no wallet connected      -> AppKit connect modal
  //   - connected but not "ready" -> prepaid top-up / authorize dialog
  // While the prepaid read is still loading we let the send through; submitMode
  // "auto" falls back to the per-prompt wallet path, so we don't false-block on
  // a slow on-chain read. When prepaid isn't configured (`available` false) the
  // gate is a no-op.
  const canPrompt = useCallback((): boolean => {
    if (!isConnected) {
      open();
      return false;
    }
    if (prepaid.available && !prepaid.isLoading && !prepaid.ready) {
      const description =
        prepaid.balance === 0n
          ? "Add LCAI to your prepaid balance to start chatting."
          : prepaid.isAuthorized
            ? "Increase your delegate's spending allowance to continue."
            : "Authorize the delegate to spend your prepaid balance.";
      toast.custom((toastId) => (
        <AlertInfo
          description={description}
          id={toastId}
          title="Prepaid balance required"
        />
      ));
      setPrepaidGateOpen(true);
      return false;
    }
    return true;
  }, [
    isConnected,
    open,
    prepaid.available,
    prepaid.isLoading,
    prepaid.ready,
    prepaid.balance,
    prepaid.isAuthorized,
  ]);

  // Device-local private memory (lib/memory.ts). The ref feeds the
  // transport's getMemoryPrefix so the lazily-created protocol transport
  // always reads the latest store without being recreated. Loaded post-mount
  // so SSR and the first client render agree.
  const [memoryStore, setMemoryStore] =
    useState<MemoryStore>(EMPTY_MEMORY_STORE);
  const memoryRef = useRef<MemoryStore>(EMPTY_MEMORY_STORE);
  const [memoryDialogOpen, setMemoryDialogOpen] = useState(false);

  useEffect(() => {
    const store = loadMemoryStore();
    memoryRef.current = store;
    setMemoryStore(store);
  }, []);

  const updateMemoryStore = useCallback((next: MemoryStore) => {
    memoryRef.current = next;
    setMemoryStore(next);
    saveMemoryStore(next);
  }, []);

  const getMemoryPrefix = useCallback(
    () => memoryPrefixFromStore(memoryRef.current),
    []
  );

  // Protocol mode: session management for on-chain encrypted chat
  const {
    getTransport: getProtocolTransport,
    failoverStatus,
    progressStatus,
    activeJobs,
    timedOutJob,
    retryFailover,
    startNewSession,
    workerCapabilities,
    claimJobTimeout,
    disputeJob,
    clearTimedOutJob,
    fetchOnChainJob,
    fetchWorkerStake,
    disputeResponseMismatch,
    hasMismatchEvidence,
  } = useProtocolSession(
    currentModelId,
    walletClient,
    address,
    id,
    submitMode,
    getMemoryPrefix
  );
  // Read-only preflight: union of capabilities across all workers eligible
  // for this model (web-search epic, Story 16). Populates at chat mount via
  // /api/models/:hex/capabilities so the toggle reflects reality BEFORE a
  // session is bound — fixes the "unlocks after Send" race.
  const { availableCapabilities } = useModelCapabilities(currentModelId);

  // searchCapable feeds the Switch's disabled state.
  //   - non-protocol mode: Vercel AI SDK does its own search, always on.
  //   - protocol mode, post-binding (workerCapabilities populated): the
  //     bound worker's snapshot is the source of truth; a session bound to
  //     a non-capable worker MUST lock the toggle off even if other capable
  //     workers exist (the session can't switch).
  //   - protocol mode, pre-binding: fall back to availableCapabilities
  //     from the preflight — "is any capable worker reachable?"
  const searchCapable = isProtocolMode
    ? workerCapabilities.length > 0
      ? workerCapabilities.includes("search")
      : availableCapabilities.includes("search")
    : true;

  const sessionRecovering = isProtocolMode && failoverStatus !== "none";

  // Build the transport — protocol mode uses DefaultChatTransport with a custom
  // fetch that routes through ProtocolTransport (encrypt → gateway → relay).
  // DefaultChatTransport handles Response → UIMessageChunk stream conversion.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const transport = useMemo(() => {
    if (isProtocolMode) {
      return new DefaultChatTransport({
        api: "/protocol",
        async fetch(_url, init) {
          const t = await getProtocolTransport();
          const body = JSON.parse((init?.body as string) ?? "{}");
          const protocolBody = {
            ...body,
            id,
            selectedVisibilityType: visibilityType,
            systemPrompt: systemPromptRef.current,
          };
          const { response } = await t.sendMessages({
            messages: protocolBody.messages ?? [],
            body: {
              ...protocolBody,
              // Per-message web-search opt-in (web-search epic, Story 16).
              // ProtocolTransport forwards this through SessionManager.submitJob
              // → GatewayClient.uploadBlob → consumer-api side-channel write.
              enableWebSearch: enableWebSearchRef.current,
              // Name of the serving model (live list), recorded into the
              // assistant message's protocolMeta for the proof panel and
              // transcripts.
              friendlyModelId: availableModelsRef.current.find(
                (m) => m.id === currentModelIdRef.current
              )?.name,
            },
            signal: init?.signal ?? undefined,
          });

          return response;
        },
      });
    }
    return new DefaultChatTransport({
      api: `${$http.baseUrl}/api/chat`,
      fetch: (url, init) =>
        fetchWithErrorHandlers(url, {
          ...init,
        }),
      prepareSendMessagesRequest(request) {
        return {
          body: {
            id: request.id,
            message: request.messages.at(-1),
            selectedChatModel: currentModelIdRef.current,
            selectedVisibilityType: visibilityType,
            systemPrompt: systemPromptRef.current,
            enableWebSearch: enableWebSearchRef.current,
            ...request.body,
          },
        };
      },
    });
  }, [id, visibilityType, getProtocolTransport]);

  // Fetch prompt templates to match initial prompt
  const { data: promptTemplates } = useSWR<PromptTemplate[]>(
    sessionStatus === "authenticated" ? "/api/prompts" : null,
    async (url: string) => {
      const response = await $http.get(url, {
        headers: {
          Authorization: `Bearer ${data?.user.token}`,
        },
      });
      if (!response.ok) return null;
      return response.json();
    },
  );

  // Match initial system prompt to a template ID
  useEffect(() => {
    if (initialSystemPrompt && promptTemplates) {
      const matchedTemplate = promptTemplates.find(
        (template) => template.prompt === initialSystemPrompt,
      );
      if (matchedTemplate) {
        setSystemPromptId(matchedTemplate.id);
      }
    }
  }, [initialSystemPrompt, promptTemplates]);

  useEffect(() => {
    currentModelIdRef.current = currentModelId;
  }, [currentModelId]);

  useEffect(() => {
    systemPromptRef.current = systemPrompt;
  }, [systemPrompt]);

  useEffect(() => {
    enableWebSearchRef.current = enableWebSearch;
  }, [enableWebSearch]);

  // Show a non-blocking toast when a job's deadline passes with no response
  useEffect(() => {
    if (!timedOutJob) return;
    const toastId = `job-timeout-${timedOutJob.jobId}`;
    toast.custom(
      () => (
        <JobTimeoutToast
          id={toastId}
          job={timedOutJob}
          onClaim={claimJobTimeout}
          onNewSession={() => {
            clearTimedOutJob();
            startNewSession();
          }}
        />
      ),
      {
        id: toastId,
        duration: Number.POSITIVE_INFINITY,
      },
    );
  }, [timedOutJob, claimJobTimeout, startNewSession, clearTimedOutJob]);

  const {
    messages,
    setMessages,
    sendMessage,
    status,
    stop,
    regenerate,
    resumeStream,
  } = useChat<ChatMessage>({
    id,
    messages: initialMessages,
    experimental_throttle: 100,
    generateId: generateUUID,
    transport,
    onData: (dataPart) => {
      setDataStream((ds) =>
        ds ? ([...ds, dataPart] as DataUIPart<CustomUIDataTypes>[]) : [],
      );
      // if (dataPart.type === "data-usage") {
      //   setUsage(dataPart.data);
      // }
    },
    onFinish: () => {
      mutate(unstable_serialize(getChatHistoryPaginationKey));
      prepaid.refetch();
      balance.refetch();
    },
    onError: (error: any) => {
      if (isProtocolAuthExpiredError(error)) {
        toast.custom((errorId) => (
          <AlertError
            id={errorId}
            title="Your session expired. Please sign in with your wallet again."
          />
        ));
        open();
        return;
      }

      if (isNoWorkerAvailableError(error)) {
        const message =
          noWorkerAvailableMessage(error) ??
          "No worker available right now — please try again.";
        toast.custom((errorId) => (
          <AlertError id={errorId} title={message} />
        ));
        return;
      }

      const { title, description } = parseWeb3Error(error);
      toast.custom((errorId) => (
        <AlertError description={description} id={errorId} title={title} />
      ));
    },
  });

  const searchParams = useSearchParams();
  const query = searchParams.get("query");

  const [hasAppendedQuery, setHasAppendedQuery] = useState(false);

  useEffect(() => {
    if (query && !hasAppendedQuery) {
      if (!canPrompt()) {
        return;
      }

      sendMessage({
        role: "user" as const,
        parts: [{ type: "text", text: query }],
      });

      setHasAppendedQuery(true);
      window.history.replaceState({}, "", `/chat/${id}`);
    }
  }, [query, sendMessage, hasAppendedQuery, id, canPrompt]);

  const { data: votes } = useSWR<Vote[]>(
    messages.length >= 2 ? `/api/vote?chatId=${id}` : null,
    fetcher,
  );

  const [attachments, setAttachments] = useState<Attachment[]>([]);

  useAutoResume({
    autoResume,
    initialMessages,
    resumeStream,
    setMessages,
    walletClient,
  });

  return (
    <>
      <div className="overscroll-behavior-contain flex h-[calc(100svh-58px)] min-w-0 touch-pan-y flex-col bg-background md:h-[calc(100svh-80px)]">
        <ChatHeader
          chatId={id}
          isReadonly={isReadonly}
          onOpenMemory={
            isProtocolMode ? () => setMemoryDialogOpen(true) : undefined
          }
          onSystemPromptChange={(promptId, prompt) => {
            setSystemPromptId(promptId);
            setSystemPrompt(prompt);
          }}
          selectedVisibilityType={initialVisibilityType}
          systemPromptId={systemPromptId}
        />

        <UsageWarningBanner
          className="mx-6 mt-4"
          subscriptionTier="basic"
          totalTokens={usage?.totalTokens ?? 0}
        />

        {sessionRecovering && (
          <SessionRecoveryBanner
            className="mb-2"
            failoverStatus={failoverStatus}
            onNewSession={startNewSession}
            onRetry={retryFailover}
          />
        )}

        <Messages
          activeJobs={activeJobs}
          chatId={id}
          claimJobTimeout={claimJobTimeout}
          disputeJob={disputeJob}
          disputeResponseMismatch={disputeResponseMismatch}
          explorerBaseUrl={process.env.NEXT_PUBLIC_EXPLORER_URL}
          fetchOnChainJob={fetchOnChainJob}
          fetchWorkerStake={fetchWorkerStake}
          hasMismatchEvidence={hasMismatchEvidence}
          isArtifactVisible={false}
          isReadonly={isReadonly}
          messages={messages}
          protocolProgressStatus={progressStatus}
          regenerate={regenerate}
          selectedModelId={initialChatModel}
          setMessages={setMessages}
          status={status}
          votes={votes}
        />

        <div
          className={
            "sticky bottom-0 z-1 mx-auto flex w-full max-w-4xl gap-2 border-t-0 bg-background px-2 pb-3 md:px-4 md:pb-4"
          }
        >
          {!isReadonly && (
            <MultimodalInput
              attachments={attachments}
              chatId={id}
              disabled={sessionRecovering}
              disabledPlaceholder="Session recovering..."
              enableWebSearch={enableWebSearch}
              input={input}
              memoryActive={
                isProtocolMode &&
                memoryStore.enabled &&
                memoryStore.entries.length > 0
              }
              messages={messages}
              onBeforeSubmit={canPrompt}
              onModelChange={setCurrentModelId}
              onOpenMemory={() => setMemoryDialogOpen(true)}
              onWebSearchToggle={setEnableWebSearch}
              searchCapable={searchCapable}
              selectedModelId={currentModelId}
              selectedVisibilityType={visibilityType}
              sendMessage={sendMessage}
              setAttachments={setAttachments}
              setInput={setInput}
              setMessages={setMessages}
              status={status}
              stop={stop}
              usage={usage}
            />
          )}
        </div>
      </div>

      <MemoryDialog
        onAdd={(text) =>
          updateMemoryStore(
            addMemoryEntry(
              memoryStore,
              text,
              generateUUID(),
              new Date().toISOString()
            )
          )
        }
        onClear={() => updateMemoryStore({ ...memoryStore, entries: [] })}
        onOpenChange={setMemoryDialogOpen}
        onRemove={(entryId) =>
          updateMemoryStore(removeMemoryEntry(memoryStore, entryId))
        }
        onToggle={(enabled) => updateMemoryStore({ ...memoryStore, enabled })}
        open={memoryDialogOpen}
        store={memoryStore}
      />

      <PrepaidBalanceDialog
        onOpenChange={setPrepaidGateOpen}
        open={prepaidGateOpen}
      />

      {/* <AlertDialog
        onOpenChange={setShowCreditCardAlert}
        open={showCreditCardAlert}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Oops! Something went wrong</AlertDialogTitle>
            <AlertDialogDescription>
              We're having trouble sending your message. Please check your
              internet connection and try again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Close</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                window.location.reload();
              }}
            >
              Try again
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog> */}
    </>
  );
}
