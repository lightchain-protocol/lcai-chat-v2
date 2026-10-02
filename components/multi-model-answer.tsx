"use client";

import type { UseChatHelpers } from "@ai-sdk/react";
import useEmblaCarousel from "embla-carousel-react";
import { motion } from "framer-motion";
import { AlertTriangle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import type { MultiModelLive } from "@/hooks/use-multi-model-session";
import { cn } from "@/lib/utils";
import {
  jobIdFromMessage,
  servedModelIdFromMessage,
} from "@/lib/protocol/served-model";
import type { OnChainJob } from "@/lib/protocol/session";
import type { ChatMessage } from "@/lib/types";
import { PreviewMessage } from "./message";
import { ModelLogo } from "./model-logo";
import { PipelineTimeline } from "./pipeline-timeline";

/** True once a row carries any answer or reasoning worth showing. */
function hasRenderableContent(message: ChatMessage): boolean {
  return message.parts.some((part) => {
    if (part.type === "text" || part.type === "reasoning") {
      return typeof part.text === "string" && part.text.trim().length > 0;
    }
    return (
      part.type === "data-protocolFinal" &&
      typeof (part.data as { text?: unknown })?.text === "string" &&
      (part.data as { text: string }).text.trim().length > 0
    );
  });
}

/**
 * One answer column of a multi-model turn — the SAME {@link PreviewMessage} a
 * single answer renders, wrapped with a small model-name label and its own
 * on-chain {@link PipelineTimeline}. Because live and reloaded turns are both
 * ordinary sibling assistant rows, this one component serves both: live it also
 * gets the transient {@link MultiModelLive} status (progress, tracked jobs) that
 * drives the timeline; on reload that is absent and the timeline collapses to
 * nothing while the persisted provenance chip carries the verdict.
 */
function AnswerColumn({
  message,
  chatId,
  explorerBaseUrl,
  status,
  fetchOnChainJob,
  fetchWorkerStake,
  isReadonly,
  setMessages,
  regenerate,
}: {
  message: ChatMessage;
  chatId: string;
  explorerBaseUrl?: string;
  status?: MultiModelLive[string];
  fetchOnChainJob?: (jobId: number) => Promise<OnChainJob | null>;
  fetchWorkerStake?: (worker: string) => Promise<bigint | null>;
  isReadonly: boolean;
  setMessages: UseChatHelpers<ChatMessage>["setMessages"];
  regenerate: UseChatHelpers<ChatMessage>["regenerate"];
}) {
  const modelName = servedModelIdFromMessage(message) ?? "Model";
  const jobId = jobIdFromMessage(message);
  const hasContent = hasRenderableContent(message);
  const live = status?.live ?? false;
  const errorText = status?.error && !hasContent ? status.error : null;

  return (
    <div className="flex snap-center flex-col gap-2 rounded-xl border border-bdr-light bg-surface-elevation-light/40 p-3">
      {/* Subtle model-name label — the one addition over a normal chat answer. */}
      <div className="flex min-w-0 items-center gap-1.5">
        <ModelLogo modelId={modelName} size={14} />
        <span className="truncate font-medium text-content-secondary text-xs">
          {modelName}
        </span>
      </div>

      {errorText ? (
        <p className="flex items-center gap-1.5 text-red-600 text-sm dark:text-red-400">
          <AlertTriangle className="shrink-0" size={14} />
          <span className="min-w-0">{errorText}</span>
        </p>
      ) : (
        <>
          {hasContent && (
            <PreviewMessage
              chatId={chatId}
              disableActions
              explorerBaseUrl={explorerBaseUrl}
              fetchOnChainJob={fetchOnChainJob}
              fetchWorkerStake={fetchWorkerStake}
              isLoading={live}
              isReadonly={isReadonly}
              jobId={jobId}
              message={message}
              regenerate={regenerate}
              requiresScrollPadding={false}
              setMessages={setMessages}
              vote={undefined}
            />
          )}

          {/* Per-column on-chain pipeline: the thinking indicator before the
              first token, then a slim provenance handle. Renders nothing after
              a reload (no live status, no tracked job). */}
          <PipelineTimeline
            activeJobs={status?.jobs ?? []}
            chatId={chatId}
            explorerBaseUrl={explorerBaseUrl}
            firstTokenSeen={status?.firstTokenSeen ?? hasContent}
            live={live}
            progressStatus={status?.progress ?? "idle"}
          />
        </>
      )}
    </div>
  );
}

/**
 * Renders the N sibling assistant rows of a multi-model turn as columns —
 * desktop grid, mobile horizontal snap-scroll — mirroring the old compare
 * layout. Grouping is decided by the caller ({@link ./messages.tsx}); this only
 * lays the rows out and delegates each to {@link AnswerColumn}.
 */
export function MultiModelAnswer({
  group,
  chatId,
  explorerBaseUrl,
  live,
  fetchOnChainJob,
  fetchWorkerStake,
  isReadonly,
  setMessages,
  regenerate,
}: {
  group: ChatMessage[];
  chatId: string;
  explorerBaseUrl?: string;
  live?: MultiModelLive;
  fetchOnChainJob?: (jobId: number) => Promise<OnChainJob | null>;
  fetchWorkerStake?: (worker: string) => Promise<bigint | null>;
  isReadonly: boolean;
  setMessages: UseChatHelpers<ChatMessage>["setMessages"];
  regenerate: UseChatHelpers<ChatMessage>["regenerate"];
}) {
  const columns = Math.max(group.length, 1);
  const isMobile = useIsMobile();

  const column = (message: ChatMessage) => (
    <AnswerColumn
      chatId={chatId}
      explorerBaseUrl={explorerBaseUrl}
      fetchOnChainJob={fetchOnChainJob}
      fetchWorkerStake={fetchWorkerStake}
      isReadonly={isReadonly}
      message={message}
      regenerate={regenerate}
      setMessages={setMessages}
      status={live?.[message.id]}
    />
  );

  // One layout at a time, never both: AnswerColumn kicks off on-chain lookups,
  // so rendering a hidden duplicate would double every request.
  if (isMobile && group.length > 1) {
    return <MobileAnswerCarousel group={group} renderColumn={column} />;
  }

  return (
    <div
      className="grid gap-3"
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {group.map((message) => (
        <div className="min-w-0" key={message.id}>
          {column(message)}
        </div>
      ))}
    </div>
  );
}

/**
 * Mobile presentation of a multi-model turn: a real paged carousel instead of a
 * raw overflow-x rail. Each answer gets the full width, the model chips double
 * as pagination, and the active chip is tracked with a shared-layout pill so
 * swiping and tapping stay in sync.
 */
function MobileAnswerCarousel({
  group,
  renderColumn,
}: {
  group: ChatMessage[];
  renderColumn: (message: ChatMessage) => React.ReactNode;
}) {
  const [emblaRef, emblaApi] = useEmblaCarousel({
    align: "start",
    containScroll: "trimSnaps",
  });
  const [selected, setSelected] = useState(0);

  useEffect(() => {
    if (!emblaApi) {
      return;
    }
    const onSelect = () => setSelected(emblaApi.selectedScrollSnap());
    onSelect();
    emblaApi.on("select", onSelect);
    emblaApi.on("reInit", onSelect);
    return () => {
      emblaApi.off("select", onSelect);
      emblaApi.off("reInit", onSelect);
    };
  }, [emblaApi]);

  const scrollTo = useCallback(
    (index: number) => emblaApi?.scrollTo(index),
    [emblaApi]
  );

  return (
    <div className="flex flex-col gap-2">
      {/* Model chips — pagination and legend in one. */}
      <div
        aria-label="Choose model answer"
        className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        role="tablist"
      >
        {group.map((message, i) => {
          const name = servedModelIdFromMessage(message) ?? "Model";
          const active = i === selected;
          return (
            <button
              aria-selected={active}
              className={cn(
                "relative flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 font-medium text-xs transition-colors",
                active ? "text-content-strong" : "text-content-subtle"
              )}
              key={message.id}
              onClick={() => scrollTo(i)}
              role="tab"
              type="button"
            >
              {active && (
                <motion.span
                  className="absolute inset-0 rounded-full border border-bdr-light bg-surface-elevation-light/70"
                  layoutId="multi-model-tab"
                  transition={{ type: "spring", stiffness: 400, damping: 34 }}
                />
              )}
              <span className="relative flex items-center gap-1.5">
                <ModelLogo modelId={name} size={13} />
                <span className="max-w-[9rem] truncate">{name}</span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="overflow-hidden" ref={emblaRef}>
        <div className="flex touch-pan-y">
          {group.map((message) => (
            <div className="min-w-0 flex-[0_0_100%] pr-2" key={message.id}>
              {renderColumn(message)}
            </div>
          ))}
        </div>
      </div>

      {/* Progress dots, for position at a glance. */}
      <div className="flex justify-center gap-1.5 pt-0.5">
        {group.map((message, i) => (
          <button
            aria-label={`Go to answer ${i + 1}`}
            className={cn(
              "h-1.5 rounded-full transition-all",
              i === selected
                ? "w-4 bg-content-secondary"
                : "w-1.5 bg-content-extraLight"
            )}
            key={message.id}
            onClick={() => scrollTo(i)}
            type="button"
          />
        ))}
      </div>
    </div>
  );
}
