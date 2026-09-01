"use client";

import type { UseChatHelpers } from "@ai-sdk/react";
import { AlertTriangle } from "lucide-react";
import type { MultiModelLive } from "@/hooks/use-multi-model-session";
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

  return (
    <div
      className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-1 md:grid md:overflow-visible"
      style={{
        // Only takes effect under md:grid; the mobile flex row ignores it.
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
      }}
    >
      {group.map((message) => (
        <div className="w-[82vw] shrink-0 md:w-auto md:shrink" key={message.id}>
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
        </div>
      ))}
    </div>
  );
}
