import type { UseChatHelpers } from "@ai-sdk/react";
import equal from "fast-deep-equal";
import { AnimatePresence } from "framer-motion";
import { ArrowDownIcon } from "lucide-react";
import { memo, useEffect, useRef } from "react";
import { useMessages } from "@/hooks/use-messages";
import type { BranchStore } from "@/lib/branches";
import type { Vote } from "@/lib/db/schema";
import type { OnChainJob } from "@/lib/protocol/session";
import type { TrackedJob } from "@/lib/protocol/transport";
import {
  type ChatMessage,
  PROTOCOL_LOADING_STATUS_LABELS,
  type ProtocolLoadingStatus,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { useDataStream } from "./data-stream-provider";
import { Conversation, ConversationContent } from "./elements/conversation";
import { Greeting } from "./greeting";
import { PreviewMessage, ThinkingMessage } from "./message";
import { PipelineTimeline } from "./pipeline-timeline";

type MessagesProps = {
  chatId: string;
  status: UseChatHelpers<ChatMessage>["status"];
  votes: Vote[] | undefined;
  messages: ChatMessage[];
  setMessages: UseChatHelpers<ChatMessage>["setMessages"];
  regenerate: UseChatHelpers<ChatMessage>["regenerate"];
  isReadonly: boolean;
  isArtifactVisible: boolean;
  selectedModelId: string;
  protocolProgressStatus?: ProtocolLoadingStatus;
  activeJobs?: TrackedJob[];
  claimJobTimeout?: (jobId: number) => Promise<{ txHash: string }>;
  disputeJob?: (jobId: number) => Promise<{ txHash: string; bond: bigint }>;
  /** Files disputeResponseMismatch with live-session evidence, if retained. */
  disputeResponseMismatch?: (jobId: number) => Promise<{ txHash: string }>;
  hasMismatchEvidence?: (jobId: number) => boolean;
  /** Reads a job from the chain so a reloaded answer stays verifiable. */
  fetchOnChainJob?: (jobId: number) => Promise<OnChainJob | null>;
  fetchWorkerStake?: (worker: string) => Promise<bigint | null>;
  explorerBaseUrl?: string;
  /** Device-local conversation branching (lib/branches.ts). */
  branchStore?: BranchStore;
  onFork?: (anchorId: string) => void;
  onSwitchBranch?: (anchorId: string, index: number) => void;
  onAddBranch?: (anchorId: string) => void;
};

function PureMessages({
  chatId,
  status,
  votes,
  messages,
  setMessages,
  regenerate,
  isReadonly,
  selectedModelId,
  protocolProgressStatus,
  activeJobs,
  claimJobTimeout,
  disputeJob,
  disputeResponseMismatch,
  hasMismatchEvidence,
  fetchOnChainJob,
  fetchWorkerStake,
  explorerBaseUrl,
  branchStore,
  onFork,
  onSwitchBranch,
  onAddBranch,
}: MessagesProps) {
  const initialScrollChatIdRef = useRef<string | null>(null);
  const {
    containerRef: messagesContainerRef,
    endRef: messagesEndRef,
    isAtBottom,
    scrollToBottom,
    hasSentMessage,
  } = useMessages({
    status,
  });

  useDataStream();

  // The protocol transport opens the assistant message as soon as the stream
  // exists, well before the worker has produced a token - first-token latency
  // is seconds, and longer on a cold model. useChat leaves "submitted" the
  // moment that happens, so keying the indicator purely off "submitted" hid it
  // during the entire wait and left an assistant bubble with no parts on
  // screen: the blank response. Keep it up until real content arrives.
  //
  // Reasoning counts as content: a reasoning model streams reasoning parts
  // before its first text part, and gating on text alone hid the whole thought
  // stream behind the "Thinking..." indicator until the answer began.
  const lastMessage = messages.at(-1);
  const awaitingFirstToken =
    status === "streaming" &&
    lastMessage?.role === "assistant" &&
    !lastMessage.parts?.some(
      (part) =>
        (part.type === "text" || part.type === "reasoning") &&
        part.text?.trim().length > 0
    );
  const showThinking = status === "submitted" || awaitingFirstToken;
  const live = status === "submitted" || status === "streaming";
  // The answer has actually begun rendering — this is the signal that turns the
  // timeline's "Generating" node green, so it holds its loading state for the
  // full inference rather than flipping done while the model is still thinking.
  const firstTokenSeen =
    status === "ready" || (status === "streaming" && !awaitingFirstToken);
  // In protocol mode the on-chain pipeline timeline replaces the single
  // "Finding a worker…" line and carries the status itself.
  const protocolActive =
    !!protocolProgressStatus && protocolProgressStatus !== "idle";

  useEffect(() => {
    if (messages.length === 0) {
      return;
    }
    if (initialScrollChatIdRef.current === chatId) {
      return;
    }

    initialScrollChatIdRef.current = chatId;
    requestAnimationFrame(() => {
      scrollToBottom("auto");
    });
  }, [chatId, messages.length, scrollToBottom]);

  useEffect(() => {
    if (status === "submitted") {
      requestAnimationFrame(() => {
        const container = messagesContainerRef.current;
        if (container) {
          container.scrollTo({
            top: container.scrollHeight,
            behavior: "smooth",
          });
        }
      });
    }
  }, [status, messagesContainerRef]);

  const renderPreview = (message: ChatMessage, index: number) => {
    const jobId =
      typeof message.metadata?.jobId === "number"
        ? message.metadata.jobId
        : undefined;
    const trackedJob =
      jobId !== undefined
        ? activeJobs?.find((j) => j.jobId === jobId)
        : undefined;
    const anchorEntry = branchStore?.[message.id];

    return (
      <PreviewMessage
        branch={
          // Fork/switch/add mutate the message list by slicing at an anchor;
          // offering that while a response is still streaming targets a list
          // that is about to change under it.
          onFork && status !== "streaming" && status !== "submitted"
            ? {
                nav: anchorEntry
                  ? {
                      index: anchorEntry.activeIndex,
                      count: anchorEntry.branches.length,
                    }
                  : null,
                canFork: index < messages.length - 1,
                onFork: () => onFork(message.id),
                onSwitch: (target) => onSwitchBranch?.(message.id, target),
                onAdd: () => onAddBranch?.(message.id),
              }
            : undefined
        }
        chatId={chatId}
        claimJobTimeout={claimJobTimeout}
        disputeJob={disputeJob}
        disputeResponseMismatch={disputeResponseMismatch}
        explorerBaseUrl={explorerBaseUrl}
        fetchOnChainJob={fetchOnChainJob}
        fetchWorkerStake={fetchWorkerStake}
        hasMismatchEvidence={hasMismatchEvidence}
        isLoading={status === "streaming" && messages.length - 1 === index}
        isReadonly={isReadonly}
        jobId={jobId}
        key={message.id}
        message={message}
        regenerate={regenerate}
        requiresScrollPadding={hasSentMessage && index === messages.length - 1}
        setMessages={setMessages}
        trackedJob={trackedJob}
        vote={
          votes
            ? votes.find((vote) => vote.messageId === message.id)
            : undefined
        }
      />
    );
  };

  return (
    <div
      className="overscroll-behavior-contain -webkit-overflow-scrolling-touch flex-1 touch-pan-y overflow-y-scroll"
      ref={messagesContainerRef}
      style={{ overflowAnchor: "none" }}
    >
      <Conversation className="lc-conversation mx-auto flex h-full min-w-0 max-w-4xl flex-col gap-4 md:gap-6">
        <ConversationContent className="flex h-full flex-col gap-4 px-2 py-4 md:gap-6 md:px-4">
          {messages.length === 0 && <Greeting />}

          {messages.map((message, index) => {
            // The placeholder assistant message is represented by the thinking
            // indicator below until it has text, so rendering it here too would
            // stack an empty bubble on top of it.
            if (awaitingFirstToken && index === messages.length - 1) {
              return null;
            }

            return renderPreview(message, index);
          })}

          {protocolActive && (
            // One mounted instance across the turn so on-chain evidence never
            // resets mid-flight. Before the answer it stands in for the thinking
            // bubble; once the answer streams it collapses to a slim provenance
            // line, pulled up to sit directly under the assistant message.
            <div className={cn(firstTokenSeen && "-mt-2 md:-mt-4")}>
              <PipelineTimeline
                activeJobs={activeJobs}
                chatId={chatId}
                explorerBaseUrl={explorerBaseUrl}
                firstTokenSeen={firstTokenSeen}
                live={live}
                progressStatus={protocolProgressStatus as ProtocolLoadingStatus}
              />
            </div>
          )}

          <AnimatePresence mode="wait">
            {showThinking && !protocolActive && (
              <ThinkingMessage
                key="thinking"
                label={
                  protocolProgressStatus
                    ? PROTOCOL_LOADING_STATUS_LABELS[protocolProgressStatus]
                    : "Thinking..."
                }
              />
            )}
          </AnimatePresence>

          <div
            className="min-h-[24px] min-w-[24px] shrink-0"
            ref={messagesEndRef}
          />
        </ConversationContent>
      </Conversation>

      {!isAtBottom && (
        <button
          aria-label="Scroll to bottom"
          className="-translate-x-1/2 absolute bottom-40 left-1/2 z-10 rounded-full border bg-background p-2 shadow-lg transition-colors hover:bg-muted"
          onClick={() => scrollToBottom("smooth")}
          type="button"
        >
          <ArrowDownIcon className="size-4" />
        </button>
      )}
    </div>
  );
}

export const Messages = memo(PureMessages, (prevProps, nextProps) => {
  if (prevProps.isArtifactVisible && nextProps.isArtifactVisible) {
    return true;
  }

  if (prevProps.status !== nextProps.status) {
    return false;
  }
  if (prevProps.selectedModelId !== nextProps.selectedModelId) {
    return false;
  }
  if (prevProps.messages.length !== nextProps.messages.length) {
    return false;
  }
  if (!equal(prevProps.messages, nextProps.messages)) {
    return false;
  }
  if (!equal(prevProps.votes, nextProps.votes)) {
    return false;
  }

  return false;
});
