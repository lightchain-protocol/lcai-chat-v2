"use client";

import { useChat } from "@ai-sdk/react";
import { useAppKit } from "@reown/appkit/react";
import { DefaultChatTransport } from "ai";
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import useSWR, { useSWRConfig } from "swr";
import { unstable_serialize } from "swr/infinite";
import { useAccount, useBalance } from "wagmi";
import { ChatHeader } from "@/components/chat-header";
import type { PromptTemplate } from "@/components/system-prompt-selector";
import { useAutoResume } from "@/hooks/use-auto-resume";
import { useChatVisibility } from "@/hooks/use-chat-visibility";
import usePrepaidBalance from "@/hooks/use-prepaid-balance";
import { useProtocolSession } from "@/hooks/use-protocol-session";
import useWeb3Clients from "@/hooks/use-web3-clients";
import type { Vote } from "@/lib/db/schema";
import { $http } from "@/lib/http";
import { ProtocolAuthExpiredError } from "@/lib/protocol/gateway-client";
import type { Attachment, ChatMessage } from "@/lib/types";
import type { AppUsage } from "@/lib/usage";
import { fetcher, generateUUID } from "@/lib/utils";
import { useDataStream } from "./data-stream-provider";
import { JobTimeoutToast } from "./job-timeout-toast";
import { Messages } from "./messages";
import { MultimodalInput } from "./multimodal-input";
import { SessionRecoveryBanner } from "./session-recovery-banner";
import { getChatHistoryPaginationKey } from "./sidebar-history";
import AlertError from "./ui/toast/AlertError";
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

  const [systemPromptId, setSystemPromptId] = useState<string>("default");
  const [systemPrompt, setSystemPrompt] = useState<string | null>(
    initialSystemPrompt || null,
  );
  const systemPromptRef = useRef(systemPrompt);

  const [enableWebSearch, setEnableWebSearch] = useState(false);
  const enableWebSearchRef = useRef(enableWebSearch);
  const { walletClient } = useWeb3Clients();
  const { address } = useAccount();
  const balance = useBalance({ address });

  // When the user has a funded prepaid balance + authorized delegate, route
  // prompts through the consumer-api (no per-prompt wallet TX). "auto" so a
  // stale read or a balance dip falls back to the wallet path gracefully.
  const prepaid = usePrepaidBalance();
  const submitMode = prepaid.ready ? "auto" : "wallet";

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
    clearTimedOutJob,
  } = useProtocolSession(currentModelId, walletClient, address, id, submitMode);

  const sessionRecovering = failoverStatus !== "none";

  // Build the transport — protocol mode uses DefaultChatTransport with a custom
  // fetch that routes through ProtocolTransport (encrypt → gateway → relay).
  // DefaultChatTransport handles Response → UIMessageChunk stream conversion.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const transport = useMemo(() => {
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
          body: protocolBody,
          signal: init?.signal ?? undefined,
        });

        return response;
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
      setDataStream((ds) => (ds ? [...ds, dataPart] : []));
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

      toast.custom((errorId) => (
        <AlertError
          id={errorId}
          title={
            error.walk?.()?.shortMessage ||
            error.walk?.()?.message ||
            error.message ||
            "Something went wrong"
          }
        />
      ));
    },
  });

  const searchParams = useSearchParams();
  const query = searchParams.get("query");

  const [hasAppendedQuery, setHasAppendedQuery] = useState(false);

  useEffect(() => {
    if (query && !hasAppendedQuery) {
      sendMessage({
        role: "user" as const,
        parts: [{ type: "text", text: query }],
      });

      setHasAppendedQuery(true);
      window.history.replaceState({}, "", `/chat/${id}`);
    }
  }, [query, sendMessage, hasAppendedQuery, id]);

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
              messages={messages}
              onModelChange={setCurrentModelId}
              onWebSearchToggle={setEnableWebSearch}
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
