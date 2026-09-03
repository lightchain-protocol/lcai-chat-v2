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
import { saveChatModelAsCookie } from "@/app/(chat)/actions";
import { ChatHeader } from "@/components/chat-header";
import type { PromptTemplate } from "@/components/system-prompt-selector";
import { useAutoResume } from "@/hooks/use-auto-resume";
import { useChatVisibility } from "@/hooks/use-chat-visibility";
import { useModelCapabilities } from "@/hooks/use-model-capabilities";
import { useModels } from "@/hooks/use-models";
import {
  type MultiModel,
  useMultiModelSession,
} from "@/hooks/use-multi-model-session";
import usePrepaidBalance from "@/hooks/use-prepaid-balance";
import { useProtocolSession } from "@/hooks/use-protocol-session";
import useWeb3Clients from "@/hooks/use-web3-clients";
import { useWorkerCounts } from "@/hooks/use-worker-counts";
import { recordModelOutcome } from "@/lib/ai/availability";
import { DEFAULT_CHAT_MODEL } from "@/lib/ai/models";
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
import { NoWorkerAvailableError } from "@/lib/protocol/session";
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
  return;
}

const isProtocolMode = process.env.NEXT_PUBLIC_USE_PROTOCOL === "true";

/** Device-local memory of the last multi-select model set. */
const SELECTED_MODELS_KEY = "lc-selected-models";

/**
 * The live model with the most eligible workers. Iterating in live-list
 * order and switching only on a strictly-greater count makes ties stable —
 * the first model among the max wins. Falls back to the first model when no
 * count is known yet, so callers always get a concrete choice.
 */
function pickModelWithMostWorkers(
  models: { id: string; name: string }[],
  counts: Record<string, number>
): { id: string; name: string } {
  let best = models[0];
  let bestCount = counts[best.id] ?? 0;
  for (const model of models) {
    const count = counts[model.id] ?? 0;
    if (count > bestCount) {
      best = model;
      bestCount = count;
    }
  }
  return best;
}

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
  // The model picker is now multi-select (1–4). One selected model = the
  // unchanged single-model chat below; 2+ = the additive multi-model fan-out.
  // Seeded single from the SSR cookie default and hydrated from localStorage
  // post-mount (below) so SSR and first client render agree.
  const [selectedModelIds, setSelectedModelIds] = useState<string[]>([
    initialChatModel,
  ]);
  // The single-model chat, its transport, and everything downstream key off one
  // model — the first selected. With one model selected this IS that model and
  // nothing changes; with several, this is the head of the list and the single
  // transport simply sits idle while the multi-model path runs instead.
  const currentModelId = selectedModelIds[0] ?? initialChatModel;
  const currentModelIdRef = useRef(currentModelId);
  // True once the user explicitly picks a model in this session, so the
  // "most workers" default below stops overriding their choice.
  const userPickedModelRef = useRef(false);
  // The most-workers default is applied at most once per session (after the
  // first time worker counts are known) so it can't thrash the selection.
  const appliedWorkerDefaultRef = useRef(false);
  // The model id of the in-flight send, recorded into the device-local
  // availability heuristic on finish/error.
  const lastSentModelRef = useRef<string | null>(null);

  // Live models are keyed by on-chain id (0x…hex); the initial/cookie value may
  // be a legacy name ("llama3-8b") or a model with no active worker, which the
  // picker can't resolve — leaving it showing "Select model". Auto-select an
  // available model (prefer DEFAULT_CHAT_MODEL by name, else the first one) so a
  // default is always chosen, like before the live-model picker landed.
  const { models: availableModels } = useModels();
  // Live per-model worker count (WorkerRegistry.getEligibleWorkers). Drives
  // the "default to the model with the most active workers" behaviour below.
  const workerCountModelIds = useMemo(
    () => availableModels.map((model) => model.id),
    [availableModels]
  );
  const { counts: workerCounts } = useWorkerCounts(workerCountModelIds);
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

    const countsKnown = Object.keys(workerCounts).length > 0;

    // Drop any selected model that has gone offline. A multi-selection keeps
    // the rest; if everything went offline it falls through to the fallback.
    const liveIds = selectedModelIds.filter((modelId) =>
      availableModels.some((model) => model.id === modelId)
    );

    if (liveIds.length === 0) {
      // Nothing selected is available — pick one usable model so the picker
      // never shows "Select model". Prefer the most-workers model once counts
      // are known, otherwise the legacy name/first-in-list default.
      const fallback = countsKnown
        ? pickModelWithMostWorkers(availableModels, workerCounts)
        : (availableModels.find((model) => model.name === DEFAULT_CHAT_MODEL) ??
          availableModels[0]);
      setSelectedModelIds([fallback.id]);
      saveChatModelAsCookie(fallback.id);
      return;
    }

    // Prune offline models out of a multi-selection without disturbing order.
    if (liveIds.length !== selectedModelIds.length) {
      setSelectedModelIds(liveIds);
    }

    // The most-workers default only applies to a lone selection — a deliberate
    // multi-select is never second-guessed. Respect an explicit in-session
    // pick, and apply the default at most once (and once counts are known) so a
    // provisional cookie default doesn't thrash while loading.
    if (liveIds.length !== 1) {
      return;
    }
    if (userPickedModelRef.current || appliedWorkerDefaultRef.current) {
      return;
    }
    if (!countsKnown) {
      return;
    }

    appliedWorkerDefaultRef.current = true;

    const soleId = liveIds[0];
    const best = pickModelWithMostWorkers(availableModels, workerCounts);
    const bestCount = workerCounts[best.id] ?? 0;
    const currentCount = workerCounts[soleId] ?? 0;
    // Switch only to a strictly better model, so the persisted cookie choice is
    // kept whenever it already ties for the most workers.
    if (best.id !== soleId && bestCount > currentCount) {
      setSelectedModelIds([best.id]);
      saveChatModelAsCookie(best.id);
    }
  }, [availableModels, selectedModelIds, workerCounts]);

  const [systemPromptId, setSystemPromptId] = useState<string>("default");
  const [systemPrompt, setSystemPrompt] = useState<string | null>(
    initialSystemPrompt || null
  );
  const systemPromptRef = useRef(systemPrompt);

  const [enableWebSearch, setEnableWebSearch] = useState(false);
  const enableWebSearchRef = useRef(enableWebSearch);

  const { walletClient, publicClient } = useWeb3Clients();
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
    getShareEvidence,
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
          // Record the outcome-tracking ref here too: in non-protocol mode
          // this happens in prepareSendMessagesRequest, but that hook isn't
          // called for this transport's own fetch, so availability outcomes
          // in protocol mode were never recorded without it.
          lastSentModelRef.current = currentModelIdRef.current;
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
        lastSentModelRef.current = currentModelIdRef.current;
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

  // Restore a previously-chosen multi-selection post-mount (never during SSR,
  // so hydration matches). The auto-default effect above then prunes anything
  // that has since gone offline.
  const hydratedSelectionRef = useRef(false);
  useEffect(() => {
    if (hydratedSelectionRef.current) {
      return;
    }
    hydratedSelectionRef.current = true;
    try {
      const raw = window.localStorage.getItem(SELECTED_MODELS_KEY);
      if (!raw) {
        return;
      }
      const parsed: unknown = JSON.parse(raw);
      const ids = Array.isArray(parsed)
        ? parsed.filter((x): x is string => typeof x === "string").slice(0, 4)
        : [];
      if (ids.length > 0) {
        userPickedModelRef.current = true;
        setSelectedModelIds(ids);
      }
    } catch {
      // Private mode / malformed value — keep the SSR default.
    }
  }, []);

  // Wraps the picker's change so an explicit selection is remembered for the
  // session and persisted (localStorage for the full set, cookie for the head
  // so an SSR reload starts on the same first model).
  const handleModelsChange = useCallback((ids: string[]) => {
    if (ids.length === 0) {
      return;
    }
    userPickedModelRef.current = true;
    setSelectedModelIds(ids);
    try {
      window.localStorage.setItem(SELECTED_MODELS_KEY, JSON.stringify(ids));
    } catch {
      // Private mode / quota — the selection just won't persist across reloads.
    }
    saveChatModelAsCookie(ids[0]);
  }, []);

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
    // The installed @ai-sdk/react (2.0.26) pins its own nested ai@5.0.26,
    // whose ChatOnFinishCallback carries no isAbort/isError (that shape is
    // from the newer `ai` this repo also depends on directly, ~L4146 of the
    // top-level node_modules/ai/dist/index.d.ts, but @ai-sdk/react resolves
    // its own isolated, older copy — pnpm keeps the two separate). Tracing
    // that version's Chat.makeRequest confirms onFinish is only ever invoked
    // after a clean, non-aborted, non-errored stream — an abort returns early
    // in the catch block and a real error routes to onError instead — so the
    // outcome-recording guard the fields would have added is already true by
    // construction here; nothing to destructure.
    onFinish: () => {
      if (lastSentModelRef.current) {
        recordModelOutcome(lastSentModelRef.current, "completed");
      }
      mutate(unstable_serialize(getChatHistoryPaginationKey));
      prepaid.refetch();
      balance.refetch();
    },
    onError: (error: any) => {
      // An expired delegate isn't a model failure — the model never got the
      // chance to answer.
      if (lastSentModelRef.current && !isProtocolAuthExpiredError(error)) {
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

      if (isNoWorkerAvailableError(error)) {
        const message =
          noWorkerAvailableMessage(error) ??
          "No worker available right now — please try again.";
        toast.custom((errorId) => <AlertError id={errorId} title={message} />);
        return;
      }

      const { title, description } = parseWeb3Error(error);
      toast.custom((errorId) => (
        <AlertError description={description} id={errorId} title={title} />
      ));
    },
  });

  // Multi-model fan-out (protocol mode). Drives its own N transports and
  // streams each answer into the SAME `messages` list as a sibling assistant
  // row via setMessages — the single-model transport above is untouched.
  const multiModel = useMultiModelSession({
    chatId: id,
    walletClient,
    publicClient,
    address,
    getMemoryPrefix,
    setMessages,
    // Same post-turn refresh the single-model onFinish does: surface the new
    // chat in the sidebar and pull the paid-job balance changes.
    onFinish: () => {
      mutate(unstable_serialize(getChatHistoryPaginationKey));
      prepaid.refetch();
      balance.refetch();
    },
  });

  // The live { id, name } models behind the current selection, in pick order.
  const selectedModels = useMemo<MultiModel[]>(
    () =>
      selectedModelIds
        .map((modelId) => availableModels.find((m) => m.id === modelId))
        .filter((m): m is MultiModel => m !== undefined),
    [selectedModelIds, availableModels]
  );

  const isMultiModel = isProtocolMode && selectedModels.length >= 2;

  const runMultiModel = multiModel.run;

  // The send the whole UI calls. One model → the untouched useChat/protocol
  // path. Two or more → append the prompt once and fan it out. Same shape as
  // useChat.sendMessage so every existing call site (composer, suggestions,
  // ?query=) routes through here unchanged.
  const sendChatMessage: typeof sendMessage = useCallback(
    (message, options) => {
      if (isMultiModel) {
        const parts =
          message && typeof message === "object" && "parts" in message
            ? ((message as { parts?: ChatMessage["parts"] }).parts ?? [])
            : [];
        const userMessage: ChatMessage = {
          id: generateUUID(),
          role: "user",
          parts,
          metadata: { createdAt: new Date().toISOString() },
        };
        runMultiModel({
          userMessage,
          models: selectedModels,
          groupId: generateUUID(),
          enableWebSearch: enableWebSearchRef.current,
          systemPrompt: systemPromptRef.current,
          selectedVisibilityType: visibilityType,
        });
        return Promise.resolve();
      }
      return sendMessage(message, options);
    },
    [isMultiModel, runMultiModel, selectedModels, sendMessage, visibilityType]
  );

  // While a multi-model turn streams, the composer must show a Stop and the
  // busy state even though useChat itself is idle (it isn't driving the send).
  const effectiveStatus = multiModel.isRunning ? "streaming" : status;
  const effectiveStop = multiModel.isRunning ? multiModel.stop : stop;

  // --- Conversation branching (device-local, lib/branches.ts) -------------
  // Loaded post-mount (not in useState) so SSR and the first client render
  // agree; the branched view is applied once per chat right after.
  const [branchStore, setBranchStore] = useState<BranchStore>({});
  const branchesLoadedRef = useRef<string | null>(null);

  useEffect(() => {
    // Readonly viewers see the true flat history (branch controls are gated the same way).
    if (isReadonly) {
      return;
    }
    if (branchesLoadedRef.current === id) {
      return;
    }
    branchesLoadedRef.current = id;
    const store = loadBranchStore(id);
    setBranchStore(store);
    if (Object.keys(store).length > 0) {
      setMessages((prev) => applyActiveBranches(prev, store));
    }
  }, [id, isReadonly, setMessages]);

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

      sendChatMessage({
        role: "user" as const,
        parts: [{ type: "text", text: query }],
      });

      setHasAppendedQuery(true);
      window.history.replaceState({}, "", `/chat/${id}`);
    }
  }, [query, sendChatMessage, hasAppendedQuery, id, canPrompt]);

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
          multiModelLive={multiModel.live}
          onAddBranch={isReadonly ? undefined : handleAddBranch}
          onFork={isReadonly ? undefined : handleFork}
          onSwitchBranch={isReadonly ? undefined : handleSwitchBranch}
          protocolProgressStatus={progressStatus}
          regenerate={regenerate}
          selectedModelId={currentModelId}
          setMessages={setMessages}
          status={status}
          votes={votes}
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
              onModelsChange={handleModelsChange}
              onOpenMemory={() => setMemoryDialogOpen(true)}
              onWebSearchToggle={setEnableWebSearch}
              searchCapable={searchCapable}
              selectedModelIds={selectedModelIds}
              selectedVisibilityType={visibilityType}
              sendMessage={sendChatMessage}
              setAttachments={setAttachments}
              setInput={setInput}
              setMessages={setMessages}
              status={effectiveStatus}
              stop={effectiveStop}
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
