"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import useSWR, { useSWRConfig } from "swr";
import { unstable_serialize } from "swr/infinite";
import { useAccount } from "wagmi";
import { ChatHeader } from "@/components/chat-header";
import type { PromptTemplate } from "@/components/system-prompt-selector";
import { useAutoResume } from "@/hooks/use-auto-resume";
import { useChatVisibility } from "@/hooks/use-chat-visibility";
import { useProtocolSession } from "@/hooks/use-protocol-session";
import useWeb3Clients from "@/hooks/use-web3-clients";
import type { Vote } from "@/lib/db/schema";
import { $http } from "@/lib/http";
import type { Attachment, ChatMessage } from "@/lib/types";
import type { AppUsage } from "@/lib/usage";
import { fetcher, fetchWithErrorHandlers, generateUUID } from "@/lib/utils";
import { useDataStream } from "./data-stream-provider";
import { Messages } from "./messages";
import { MultimodalInput } from "./multimodal-input";
import { getChatHistoryPaginationKey } from "./sidebar-history";
import { SessionRecoveryBanner } from "./session-recovery-banner";
import AlertError from "./ui/toast/AlertError";
import { UsageWarningBanner } from "./usage-warning-banner";
import type { VisibilityType } from "./visibility-selector";

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

  const [input, setInput] = useState<string>("");
  const [usage] = useState<AppUsage | undefined>(initialLastContext);
  const [currentModelId, setCurrentModelId] = useState(initialChatModel);
  const currentModelIdRef = useRef(currentModelId);

  const [systemPromptId, setSystemPromptId] = useState<string>("default");
  const [systemPrompt, setSystemPrompt] = useState<string | null>(
    initialSystemPrompt || null
  );
  const systemPromptRef = useRef(systemPrompt);

  const [enableWebSearch, setEnableWebSearch] = useState(false);
  const enableWebSearchRef = useRef(enableWebSearch);
  const { walletClient } = useWeb3Clients();
  const { address } = useAccount();

  // Protocol mode: session management for on-chain encrypted chat
  const {
    getTransport: getProtocolTransport,
    failoverStatus,
    retryFailover,
    startNewSession,
  } = useProtocolSession(currentModelId, walletClient, address, id);

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
            body: protocolBody,
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
    fetcher
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
    systemPromptRef.current = systemPrompt;
  }, [systemPrompt]);

  useEffect(() => {
    enableWebSearchRef.current = enableWebSearch;
  }, [enableWebSearch]);

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
    },
    onError: (error: any) => {
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
          chatId={id}
          isArtifactVisible={false}
          isReadonly={isReadonly}
          messages={messages}
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
