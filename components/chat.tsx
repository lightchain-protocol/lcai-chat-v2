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
import { useLocalStorage } from "usehooks-ts";
import { useAccount, useBalance } from "wagmi";
import { ChatHeader } from "@/components/chat-header";
import type { PromptTemplate } from "@/components/system-prompt-selector";
import { useAutoResume } from "@/hooks/use-auto-resume";
import { useChatVisibility } from "@/hooks/use-chat-visibility";
import usePrepaidBalance from "@/hooks/use-prepaid-balance";
import { useProtocolSession } from "@/hooks/use-protocol-session";
import useWeb3Clients from "@/hooks/use-web3-clients";
import { AUTO_MODEL_ID, type AutoRoute, routePrompt } from "@/lib/ai/auto-route";
import { recordModelOutcome } from "@/lib/ai/availability";
import type { HeatTier } from "@/lib/ai/heat-tiers";
import {
  hasMaxVariant,
  modelSupportsVoice,
  resolveTierModelId,
} from "@/lib/ai/models";
import {
  addBranch,
  applyActiveBranches,
  type BranchStore,
  forkAt,
  loadBranchStore,
  saveBranchStore,
  switchBranch,
} from "@/lib/branches";
import type { Vote } from "@/lib/db/schema";
import { $http } from "@/lib/http";
import {
  addMemoryEntry,
  EMPTY_MEMORY_STORE,
  loadMemoryStore,
  type MemoryStore,
  memoryPrefixFromStore,
  removeMemoryEntry,
  saveMemoryStore,
} from "@/lib/memory";
import { ProtocolAuthExpiredError } from "@/lib/protocol/gateway-client";
import {
  DEFAULT_WEB_SEARCH_MODE,
  type WebSearchMode,
} from "@/lib/protocol/search-intent";
import type { Attachment, ChatMessage, CustomUIDataTypes } from "@/lib/types";
import type { AppUsage } from "@/lib/usage";
import { fetcher, fetchWithErrorHandlers, generateUUID } from "@/lib/utils";
import { parseWeb3Error } from "@/lib/utils/web3-errors";
import { useDataStream } from "./data-stream-provider";
import { JobTimeoutToast } from "./job-timeout-toast";
import { MemoryDialog } from "./memory-dialog";
import { Messages } from "./messages";
import { MultimodalInput } from "./multimodal-input";
import { PrepaidBalanceDialog } from "./prepaid-balance-dialog";
import { SessionRecoveryBanner } from "./session-recovery-banner";
import { ShareTranscriptButton } from "./share-transcript-button";
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
  const { status: sessionStatus } = useSession();
  const { open } = useAppKit();

  const [input, setInput] = useState<string>("");
  const [usage] = useState<AppUsage | undefined>(initialLastContext);
  const [currentModelId, setCurrentModelId] = useState(initialChatModel);
  const currentModelIdRef = useRef(currentModelId);
  // Last auto-routing decision, shown as "auto → {model} · {reason}" under
  // the composer so the heuristic can never silently spend a bigger fee.
  const [autoRoute, setAutoRoute] = useState<AutoRoute | null>(null);

  // Heat tier (Standard | Max), persisted per browser. The ref feeds the
  // transport closure so the lazily-created transport always reads the live
  // tier. Arming is sticky across model switches ONLY when the new model has
  // a Max variant — see handleModelChange.
  const [heatTier, setHeatTier] = useLocalStorage<HeatTier>(
    "heat-tier",
    "standard"
  );
  const heatTierRef = useRef(heatTier);
  // The catalogue id (base or -max) of the in-flight send, recorded into the
  // device-local availability heuristic on finish/error.
  const lastSentModelRef = useRef<string | null>(null);

  const [systemPromptId, setSystemPromptId] = useState<string>("default");
  const [systemPrompt, setSystemPrompt] = useState<string | null>(
    initialSystemPrompt || null
  );
  const systemPromptRef = useRef(systemPrompt);

  const [webSearchMode, setWebSearchMode] = useState<WebSearchMode>(
    DEFAULT_WEB_SEARCH_MODE
  );
  const webSearchModeRef = useRef(webSearchMode);

  // "Speak responses" opt-in (envelope v2 audioResponse). Persisted per
  // browser; effective only when the selected model's worker runs the TTS
  // sidecar — the toggle is hidden otherwise (modelSupportsVoice), and the
  // double-gate below keeps a stale stored true from reaching a non-voice
  // model's envelope.
  const [speakResponses, setSpeakResponses] = useLocalStorage(
    "speak-responses",
    false
  );
  const speakResponsesRef = useRef(speakResponses);
  const { walletClient } = useWeb3Clients();
  const { address, isConnected } = useAccount();
  const balance = useBalance({ address });

  // Pre-send gate: a prompt only produces a response when the user has a
  // connected wallet AND a usable prepaid balance (funded, delegate authorized,
  // allowance available). Otherwise the on-chain prompt is accepted but never
  // answered. This dialog is the existing deposit/authorize modal, opened on a
  // blocked send.
  const [prepaidGateOpen, setPrepaidGateOpen] = useState(false);

  // Device-local private memory (lib/memory.ts). The ref feeds the
  // transport's getMemoryPrefix so the lazily-created protocol transport
  // always reads the latest store without being recreated. Loaded post-mount
  // like the branch store, keeping SSR and first client render in agreement.
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

  // Protocol mode: session management for on-chain encrypted chat
  const {
    getTransport: getProtocolTransport,
    failoverStatus,
    progressStatus,
    activeJobs,
    timedOutJob,
    retryFailover,
    startNewSession,
    claimJobTimeout,
    disputeJob,
    disputeResponseMismatch,
    hasMismatchEvidence,
    getShareEvidence,
    fetchOnChainJob,
    fetchWorkerStake,
    clearTimedOutJob,
  } = useProtocolSession(
    currentModelId,
    walletClient,
    address,
    id,
    submitMode,
    getMemoryPrefix
  );
  const sessionRecovering = isProtocolMode && failoverStatus !== "none";

  // Build the transport — protocol mode uses DefaultChatTransport with a custom
  // fetch that routes through ProtocolTransport (encrypt → gateway → relay).
  // DefaultChatTransport handles Response → UIMessageChunk stream conversion.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const transport = useMemo(() => {
    // Max tiering composes with every send path the same way: resolve the
    // base id, then map it to its `{base}-max` catalogue entry when armed.
    // resolveTierModelId falls back to the base id when no Max entry exists,
    // so an armed-but-unavailable tier can never produce an unknown id.
    const applyTier = (baseId: string): string =>
      baseId === AUTO_MODEL_ID
        ? baseId
        : resolveTierModelId(baseId, heatTierRef.current);

    // "Auto" resolves against the actual outgoing message at send time, so a
    // fresh chat's first send can't race a not-yet-applied setState. The
    // decision is surfaced via autoRoute for the composer's reveal line.
    const resolveAutoRoute = (
      lastMessage:
        | { role?: string; parts?: Record<string, unknown>[] }
        | undefined
    ): string | undefined => {
      if (currentModelIdRef.current !== AUTO_MODEL_ID) {
        return;
      }
      const parts = lastMessage?.parts ?? [];
      const prompt = parts
        .filter((p) => p.type === "text")
        .map((p) => (typeof p.text === "string" ? p.text : ""))
        .join("\n");
      const hasImage = parts.some(
        (p) =>
          p.type === "file" &&
          typeof p.mediaType === "string" &&
          p.mediaType.startsWith("image/")
      );
      const route = routePrompt({ prompt, hasImage });
      const tiered = applyTier(route.modelId);
      setAutoRoute(
        tiered === route.modelId ? route : { ...route, tier: "max" }
      );
      return tiered;
    };

    if (isProtocolMode) {
      return new DefaultChatTransport({
        api: "/protocol",
        async fetch(_url, init) {
          const body = JSON.parse((init?.body as string) ?? "{}");
          const modelOverride =
            resolveAutoRoute((body.messages ?? []).at(-1)) ??
            applyTier(currentModelIdRef.current);
          lastSentModelRef.current = modelOverride;
          const t = await getProtocolTransport(modelOverride);
          const protocolBody = {
            ...body,
            id,
            selectedVisibilityType: visibilityType,
            systemPrompt: systemPromptRef.current,
            // Friendly catalogue id of this send's resolved model (base or
            // -max); the transport records it into protocolMeta.model.
            friendlyModelId: modelOverride,
          };
          const { response } = await t.sendMessages({
            messages: protocolBody.messages ?? [],
            body: {
              ...protocolBody,
              // Per-message web-search setting (web-search epic, Story 16).
              // ProtocolTransport resolves the mode against the prompt, then
              // forwards the decision through SessionManager.submitJob →
              // GatewayClient.uploadBlob → consumer-api side-channel write.
              webSearchMode: webSearchModeRef.current,
              // Spoken-output opt-in → envelope v2 audioResponse. Gated on
              // the live model pick, not just the stored preference. (Voice
              // capability keys off the base id, so a -max id resolves the
              // same as its base.)
              audioResponse:
                speakResponsesRef.current && modelSupportsVoice(modelOverride),
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
        // Non-protocol path: "auto" resolves here, against the outgoing
        // message, so the API always receives a concrete model id.
        const selectedChatModel =
          resolveAutoRoute(request.messages.at(-1)) ??
          applyTier(currentModelIdRef.current);
        lastSentModelRef.current = selectedChatModel;
        return {
          body: {
            id: request.id,
            message: request.messages.at(-1),
            selectedChatModel,
            selectedVisibilityType: visibilityType,
            systemPrompt: systemPromptRef.current,
            webSearchMode: webSearchModeRef.current,
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
      const response = await $http.get(url);
      if (!response.ok) return null;
      return response.json();
    }
  );

  // Match initial system prompt to a template ID
  useEffect(() => {
    if (initialSystemPrompt && promptTemplates) {
      const matchedTemplate = promptTemplates.find(
        (template) => template.prompt === initialSystemPrompt
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
    heatTierRef.current = heatTier;
  }, [heatTier]);

  useEffect(() => {
    systemPromptRef.current = systemPrompt;
  }, [systemPrompt]);

  useEffect(() => {
    webSearchModeRef.current = webSearchMode;
  }, [webSearchMode]);

  useEffect(() => {
    speakResponsesRef.current = speakResponses;
  }, [speakResponses]);

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
      }
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
        ds ? ([...ds, dataPart] as DataUIPart<CustomUIDataTypes>[]) : []
      );
      // if (dataPart.type === "data-usage") {
      //   setUsage(dataPart.data);
      // }
    },
    onFinish: () => {
      mutate(unstable_serialize(getChatHistoryPaginationKey));
      prepaid.refetch();
      balance.refetch();
      if (lastSentModelRef.current) {
        recordModelOutcome(lastSentModelRef.current, "completed");
      }
    },
    onError: (error: any) => {
      if (lastSentModelRef.current) {
        recordModelOutcome(lastSentModelRef.current, "failed");
      }
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

      const { title, description } = parseWeb3Error(error);
      toast.custom((errorId) => (
        <AlertError description={description} id={errorId} title={title} />
      ));
    },
  });

  // --- Conversation branching (device-local, lib/branches.ts) -------------
  // Loaded post-mount (not in useState) so SSR and the first client render
  // agree; the branched view is applied once per chat right after.
  const [branchStore, setBranchStore] = useState<BranchStore>({});
  const branchesLoadedRef = useRef<string | null>(null);

  useEffect(() => {
    if (branchesLoadedRef.current === id) {
      return;
    }
    branchesLoadedRef.current = id;
    const store = loadBranchStore(id);
    setBranchStore(store);
    if (Object.keys(store).length > 0) {
      setMessages((prev) => applyActiveBranches(prev, store));
    }
  }, [id, setMessages]);

  const handleFork = useCallback(
    (anchorId: string) => {
      const index = messages.findIndex((m) => m.id === anchorId);
      if (index === -1 || index >= messages.length - 1) {
        return;
      }
      const now = new Date().toISOString();
      const next = forkAt(
        branchStore,
        anchorId,
        messages.slice(index + 1),
        now
      );
      setBranchStore(next);
      saveBranchStore(id, next);
      setMessages(messages.slice(0, index + 1));
    },
    [messages, branchStore, id, setMessages]
  );

  const handleSwitchBranch = useCallback(
    (anchorId: string, target: number) => {
      const index = messages.findIndex((m) => m.id === anchorId);
      if (index === -1) {
        return;
      }
      const now = new Date().toISOString();
      const result = switchBranch(
        branchStore,
        anchorId,
        target,
        messages.slice(index + 1),
        now
      );
      setBranchStore(result.store);
      saveBranchStore(id, result.store);
      setMessages([
        ...messages.slice(0, index + 1),
        ...(result.tail as ChatMessage[]),
      ]);
    },
    [messages, branchStore, id, setMessages]
  );

  const handleAddBranch = useCallback(
    (anchorId: string) => {
      const index = messages.findIndex((m) => m.id === anchorId);
      if (index === -1) {
        return;
      }
      const now = new Date().toISOString();
      const next = addBranch(
        branchStore,
        anchorId,
        messages.slice(index + 1),
        now
      );
      setBranchStore(next);
      saveBranchStore(id, next);
      setMessages(messages.slice(0, index + 1));
    },
    [messages, branchStore, id, setMessages]
  );

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
    fetcher
  );

  const [attachments, setAttachments] = useState<Attachment[]>([]);

  useAutoResume({
    autoResume,
    initialMessages,
    resumeStream,
    setMessages,
    walletClient,
  });

  // Switching models with Max armed: keep the tier when the new model has a
  // Max variant, reset visibly to Standard when it doesn't — silently staying
  // "max" while running standard would misstate what the next job costs.
  const handleModelChange = useCallback(
    (modelId: string) => {
      setCurrentModelId(modelId);
      if (
        heatTierRef.current === "max" &&
        modelId !== AUTO_MODEL_ID &&
        !hasMaxVariant(modelId)
      ) {
        setHeatTier("standard");
      }
    },
    [setHeatTier]
  );

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

        {!isReadonly && messages.length > 0 && (
          <div className="flex justify-end px-4 pt-1">
            <ShareTranscriptButton
              chatId={id}
              getShareEvidence={getShareEvidence}
              messages={messages}
            />
          </div>
        )}

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
          branchStore={isReadonly ? undefined : branchStore}
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
          onAddBranch={isReadonly ? undefined : handleAddBranch}
          onFork={isReadonly ? undefined : handleFork}
          onSwitchBranch={isReadonly ? undefined : handleSwitchBranch}
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
              autoRoute={autoRoute}
              chatId={id}
              disabled={sessionRecovering}
              disabledPlaceholder="Session recovering..."
              heatTier={heatTier}
              input={input}
              memoryActive={
                isProtocolMode &&
                memoryStore.enabled &&
                memoryStore.entries.length > 0
              }
              messages={messages}
              onBeforeSubmit={canPrompt}
              onHeatTierChange={setHeatTier}
              onModelChange={handleModelChange}
              onOpenMemory={() => setMemoryDialogOpen(true)}
              onSpeakResponsesChange={setSpeakResponses}
              onWebSearchModeChange={setWebSearchMode}
              selectedModelId={currentModelId}
              selectedVisibilityType={visibilityType}
              sendMessage={sendMessage}
              setAttachments={setAttachments}
              setInput={setInput}
              setMessages={setMessages}
              speakResponses={speakResponses}
              status={status}
              stop={stop}
              usage={usage}
              webSearchMode={webSearchMode}
            />
          )}
        </div>
      </div>

      <PrepaidBalanceDialog
        onOpenChange={setPrepaidGateOpen}
        open={prepaidGateOpen}
      />

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
