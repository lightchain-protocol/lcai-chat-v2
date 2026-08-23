import type { UseChatHelpers } from "@ai-sdk/react";
import equal from "fast-deep-equal";
import { AnimatePresence } from "framer-motion";
import { ArrowDownIcon } from "lucide-react";
import { Fragment, memo, useEffect, useRef } from "react";
import { useMessages } from "@/hooks/use-messages";
import type { BranchStore } from "@/lib/branches";
import type { Vote } from "@/lib/db/schema";
import { getDuelMeta } from "@/lib/protocol/duel";
import type { OnChainJob } from "@/lib/protocol/session";
import type { TrackedJob } from "@/lib/protocol/transport";
import {
  type ChatMessage,
  PROTOCOL_LOADING_STATUS_LABELS,
  type ProtocolLoadingStatus,
} from "@/lib/types";
import { useDataStream } from "./data-stream-provider";
import { DuelGrid } from "./duel-grid";
import { Conversation, ConversationContent } from "./elements/conversation";
import { Greeting } from "./greeting";
import { PreviewMessage, ThinkingMessage } from "./message";

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
  // screen: the blank response. Keep it up until real text arrives.
  const lastMessage = messages.at(-1);
  const awaitingFirstToken =
    status === "streaming" &&
    lastMessage?.role === "assistant" &&
    !lastMessage.parts?.some(
      (part) => part.type === "text" && part.text.trim().length > 0
    );
  const showThinking = status === "submitted" || awaitingFirstToken;

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

  // Duel grouping (bc-2 §1): the anchor user message carries
  // protocolMeta.duel {group, side:"A", model}, side B's assistant answer
  // carries {group, side:"B", model}. Side A's assistant reply carries no
  // duel meta (normal useChat path) — find it as the first duel-less
  // assistant message within the anchor's turn. Purely positional pairing
  // (messages[i+1]) raced side B's upsert: when side B's stream landed
  // first, side A was pushed to index i+2, the pane falsely read "This side
  // didn't produce an answer", and side A rendered standalone below the grid.
  const duelSideBByGroup = new Map<string, ChatMessage>();
  for (const m of messages) {
    const duel = getDuelMeta(m);
    if (duel?.side === "B") {
      duelSideBByGroup.set(duel.group, m);
    }
  }
  const duelSideAIds = new Set<string>();
  const duelSideAByGroup = new Map<string, ChatMessage>();
  messages.forEach((m, i) => {
    const duel = getDuelMeta(m);
    if (m.role !== "user" || duel?.side !== "A") {
      return;
    }
    for (
      let j = i + 1;
      j < messages.length && messages[j].role !== "user";
      j++
    ) {
      const candidate = messages[j];
      if (candidate.role === "assistant" && !getDuelMeta(candidate)) {
        duelSideAIds.add(candidate.id);
        duelSideAByGroup.set(duel.group, candidate);
        break;
      }
    }
  });

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
          onFork
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

            const duel = getDuelMeta(message);

            // Duel panes render inside the grid under their anchor, not
            // standalone in the flow.
            if (duel?.side === "B" || duelSideAIds.has(message.id)) {
              return null;
            }

            if (message.role === "user" && duel?.side === "A") {
              const sideB = duelSideBByGroup.get(duel.group);
              const sideA = duelSideAByGroup.get(duel.group);

              return (
                <Fragment key={message.id}>
                  {renderPreview(message, index)}
                  {sideB && (
                    <DuelGrid
                      modelA={duel.model}
                      modelB={getDuelMeta(sideB)?.model ?? ""}
                      paneA={
                        sideA ? (
                          renderPreview(sideA, messages.indexOf(sideA))
                        ) : (
                          <p className="text-content-soft text-sm">
                            This side didn&apos;t produce an answer.
                          </p>
                        )
                      }
                      paneB={renderPreview(sideB, messages.indexOf(sideB))}
                    />
                  )}
                </Fragment>
              );
            }

            return renderPreview(message, index);
          })}

          <AnimatePresence mode="wait">
            {showThinking && (
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
