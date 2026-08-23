"use client";
import type { UseChatHelpers } from "@ai-sdk/react";
import equal from "fast-deep-equal";
import { motion } from "framer-motion";
import { memo, useMemo, useState } from "react";
import { useIsClient } from "usehooks-ts";
import type { Vote } from "@/lib/db/schema";
import type { OnChainJob } from "@/lib/protocol/session";
import type { TrackedJob } from "@/lib/protocol/transport";
import type { ChatMessage, WebSearchSource } from "@/lib/types";
import { cn, sanitizeText } from "@/lib/utils";
import { Shimmer } from "./ai-elements/shimmer";
import { ArtifactCard } from "./artifact";
import { AudioStreamPlayer } from "./audio-stream-player";
import { CitationResponse, type CitationSource } from "./citation-response";
import { useDataStream } from "./data-stream-provider";
import { MessageContent } from "./elements/message";
import { Response } from "./elements/response";
import { LCAIIcon } from "./icons";
import { MessageActions } from "./message-actions";
import { MessageEditor } from "./message-editor";
import { MessageJobActions } from "./message-job-actions";
import { MessageReasoning } from "./message-reasoning";
import { PreviewAttachment } from "./preview-attachment";
import { ProvenanceChip } from "./provenance-chip";
import { SourceLinkChip } from "./source-link-chip";
import { Weather } from "./weather";

const PurePreviewMessage = ({
  chatId,
  message,
  vote,
  isLoading,
  setMessages,
  regenerate,
  isReadonly,
  requiresScrollPadding,
  jobId,
  trackedJob,
  claimJobTimeout,
  disputeJob,
  disputeResponseMismatch,
  hasMismatchEvidence,
  fetchOnChainJob,
  fetchWorkerStake,
  explorerBaseUrl,
}: {
  chatId: string;
  message: ChatMessage;
  vote: Vote | undefined;
  isLoading: boolean;
  setMessages: UseChatHelpers<ChatMessage>["setMessages"];
  regenerate: UseChatHelpers<ChatMessage>["regenerate"];
  isReadonly: boolean;
  requiresScrollPadding: boolean;
  jobId?: number;
  trackedJob?: TrackedJob;
  claimJobTimeout?: (jobId: number) => Promise<{ txHash: string }>;
  disputeJob?: (jobId: number) => Promise<{ txHash: string; bond: bigint }>;
  /** Files disputeResponseMismatch with live-session evidence, if retained. */
  disputeResponseMismatch?: (jobId: number) => Promise<{ txHash: string }>;
  hasMismatchEvidence?: (jobId: number) => boolean;
  /** Reads a job from the chain so a reloaded answer stays verifiable. */
  fetchOnChainJob?: (jobId: number) => Promise<OnChainJob | null>;
  fetchWorkerStake?: (worker: string) => Promise<bigint | null>;
  explorerBaseUrl?: string;
}) => {
  const [mode, setMode] = useState<"view" | "edit">("view");
  const isClient = useIsClient();

  const parts = message.parts ?? [];

  const attachmentsFromMessage = parts.filter((part) => part.type === "file");

  // Arrives as a data part both live and after a reload: the worker sends it
  // on its own frame kind mid-stream, and completeAssistantMessage persists
  // the same shape, so a refresh keeps the badge.
  const generationStats = useMemo(() => {
    for (const part of parts) {
      if (part.type === "data-generationStats" && part.data) {
        return part.data;
      }
    }
    return null;
  }, [parts]);

  const responseProof = useMemo(() => {
    for (const part of parts) {
      if (part.type === "data-responseProof" && part.data) {
        return part.data;
      }
    }
    return null;
  }, [parts]);

  // The settlement journey and browser-measured timing, reconciled in place
  // during the stream (stable part ids) and persisted in final form, so the
  // same record renders live and after a reload.
  const settlement = useMemo(() => {
    for (const part of parts) {
      if (part.type === "data-settlement" && part.data) {
        return part.data;
      }
    }
    return null;
  }, [parts]);

  const streamMetrics = useMemo(() => {
    for (const part of parts) {
      if (part.type === "data-streamMetrics" && part.data) {
        return part.data;
      }
    }
    return null;
  }, [parts]);

  const protocolFinalText = useMemo(() => {
    for (const part of parts) {
      if (
        part.type === "data-protocolFinal" &&
        part.data &&
        typeof part.data.text === "string"
      ) {
        return part.data.text;
      }
    }
    return null;
  }, [parts]);

  // Voice output: the descriptor reconciles in place (header, then final);
  // PCM chunks append under unique ids and are live-only — never persisted,
  // so after a reload only the descriptor's badge remains.
  const audioStream = useMemo(() => {
    for (const part of parts) {
      if (part.type === "data-audioStream" && part.data) {
        return part.data;
      }
    }
    return null;
  }, [parts]);

  const audioChunks = useMemo(() => {
    const collected: Array<{ seq: number; pcm: string }> = [];
    for (const part of parts) {
      if (part.type === "data-audioChunk" && part.data) {
        collected.push(part.data);
      }
    }
    return collected;
  }, [parts]);

  const firstTextPartIndex = useMemo(
    () => parts.findIndex((part) => part.type === "text"),
    [parts]
  );

  // Collect all search results from protocol source metadata and legacy webSearch tool calls.
  const searchResults = useMemo(() => {
    const results: CitationSource[] = [];

    for (const part of parts) {
      if (part.type === "data-webSearchSources" && part.data?.sources) {
        results.push(...part.data.sources.map(toCitationSource));
      }
      if (
        part.type === "tool-webSearch" &&
        part.state === "output-available" &&
        part.output.success &&
        part.output.results
      ) {
        results.push(...part.output.results);
      }
    }

    return results;
  }, [parts]);

  const orderedSources = useMemo(
    () =>
      [...searchResults].sort((a, b) => {
        if (a.position !== b.position) return a.position - b.position;
        return a.url.localeCompare(b.url);
      }),
    [searchResults]
  );

  // Replace citation patterns with inline citation components
  const replaceCitations = (text: string): string => {
    if (!searchResults.length) return text;

    return text.replace(/(\[\d+\])+|\[\s*\d+(?:\s*,\s*\d+)*\s*\]/g, (match) => {
      const nums = match.match(/\d+/g)?.map(Number) || [];
      const sources = nums
        .map((n) => searchResults.find((r) => r.position === n))
        .filter((s) => s);

      return sources.length
        ? `<citation-response sources="${JSON.stringify(sources).replaceAll('"', "&quot;")}" />`
        : match;
    });
  };

  useDataStream();

  if (!isClient) {
    return null;
  }

  return (
    <motion.div
      animate={{ opacity: 1 }}
      className="group/message w-full"
      data-role={message.role}
      data-testid={`message-${message.role}`}
      initial={{ opacity: 0 }}
    >
      <div
        className={cn("flex w-full items-start gap-2 md:gap-3", {
          "justify-end": message.role === "user" && mode !== "edit",
          "justify-start": message.role === "assistant",
        })}
      >
        {message.role === "assistant" && (
          <div className="-mt-1 flex size-8 shrink-0 items-center justify-center rounded-full bg-background p-1 ring-1 ring-border">
            <LCAIIcon size={14} />
          </div>
        )}

        <div
          className={cn("flex flex-col", {
            "gap-2 md:gap-4": parts.some(
              (p) => p.type === "text" && p.text?.trim()
            ),
            "min-h-96": message.role === "assistant" && requiresScrollPadding,
            "w-full":
              (message.role === "assistant" &&
                parts.some((p) => p.type === "text" && p.text?.trim())) ||
              mode === "edit",
            "max-w-[calc(100%-2.5rem)] sm:max-w-[min(fit-content,80%)]":
              message.role === "user" && mode !== "edit",
          })}
        >
          {attachmentsFromMessage.length > 0 && (
            <div
              className="flex flex-row justify-end gap-2"
              data-testid={"message-attachments"}
            >
              {attachmentsFromMessage.map((attachment) => (
                <PreviewAttachment
                  attachment={{
                    name: attachment.filename ?? "file",
                    contentType: attachment.mediaType,
                    url: attachment.url,
                  }}
                  key={attachment.url}
                />
              ))}
            </div>
          )}

          {parts.map((part, index) => {
            const { type } = part;
            const key = `message-${message.id}-part-${index}`;

            if (type === "reasoning" && part.text?.trim().length > 0) {
              return (
                <MessageReasoning
                  isLoading={isLoading}
                  key={key}
                  reasoning={part.text}
                />
              );
            }

            // Artifact frames render as cards in delivery order. Each card
            // carries the delivered-not-settled badge itself.
            if (type === "data-artifact" && part.data) {
              return <ArtifactCard descriptor={part.data} key={key} />;
            }

            // Audio parts are consumed once, below, by AudioStreamPlayer —
            // rendering each chunk here would flood the message body.
            if (type === "data-audioStream" || type === "data-audioChunk") {
              return null;
            }

            if (type === "text") {
              if (
                message.role === "assistant" &&
                protocolFinalText !== null &&
                index !== firstTextPartIndex
              ) {
                return null;
              }
              const displayText =
                message.role === "assistant" && protocolFinalText !== null
                  ? protocolFinalText
                  : (part.text ?? "");
              if (mode === "view") {
                return (
                  <div key={key}>
                    <MessageContent
                      className={cn({
                        "wrap-break-word w-fit rounded-2xl bg-surface-base-faint px-3 py-2 text-content-strong":
                          message.role === "user",
                        "bg-transparent px-0 py-0 text-left":
                          message.role === "assistant",
                      })}
                      data-testid="message-content"
                    >
                      {message.role === "assistant" &&
                      searchResults.length > 0 ? (
                        <Response
                          components={{
                            // @ts-expect-error
                            "citation-response": (props: {
                              sources: string;
                            }) => (
                              <CitationResponse
                                sources={JSON.parse(props.sources)}
                              />
                            ),
                          }}
                        >
                          {replaceCitations(sanitizeText(displayText))}
                        </Response>
                      ) : (
                        <Response
                          components={{
                            a({ href, children }) {
                              if (!href) return <>{children}</>;
                              return <SourceLinkChip href={href} />;
                            },
                          }}
                        >
                          {sanitizeText(displayText)}
                        </Response>
                      )}
                    </MessageContent>
                  </div>
                );
              }

              if (mode === "edit") {
                return (
                  <div
                    className="flex w-full flex-row items-start gap-3"
                    key={key}
                  >
                    <div className="size-8" />
                    <div className="min-w-0 flex-1">
                      <MessageEditor
                        key={message.id}
                        message={message}
                        regenerate={regenerate}
                        setMessages={setMessages}
                        setMode={setMode}
                      />
                    </div>
                  </div>
                );
              }
            }

            if (type === "tool-getWeather") {
              const { toolCallId, state } = part;

              if (state === "input-available" || state === "input-streaming") {
                return (
                  <Shimmer as="p" duration={2} key={toolCallId}>
                    Checking the weather...
                  </Shimmer>
                );
              }

              if (state === "output-available") {
                return (
                  <Weather key={toolCallId} weatherAtLocation={part.output} />
                );
              }
            }

            if (type === "tool-webSearch") {
              const { toolCallId, state } = part;
              if (state === "input-available" || state === "input-streaming") {
                return (
                  <Shimmer as="p" duration={2} key={toolCallId}>
                    Searching the web...
                  </Shimmer>
                );
              }
            }

            // if (type === "tool-webSearch") {
            //   const { toolCallId, state } = part;

            //   return (
            //     <Tool defaultOpen={false} key={toolCallId}>
            //       <ToolHeader state={state} type="tool-webSearch" />
            //       <ToolContent>
            //         {state === "input-available" && (
            //           <ToolInput input={part.input} />
            //         )}
            //         {state === "output-available" && (
            //           <ToolOutput
            //             errorText={
            //               part.output.success ? undefined : part.output.message
            //             }
            //             output={
            //               part.output.success ? (
            //                 <WebSearchSources searchResults={part.output} />
            //               ) : null
            //             }
            //           />
            //         )}
            //       </ToolContent>
            //     </Tool>
            //   );
            // }

            return null;
          })}

          {message.role === "assistant" && orderedSources.length > 0 && (
            <div className="mt-1 border-border/70 border-t pt-3">
              <div className="mb-2 font-medium text-content-subtle text-xs uppercase tracking-normal">
                Sources
              </div>
              <div className="grid gap-2">
                {orderedSources.map((source) => (
                  <a
                    className="group/source grid grid-cols-[1.75rem_1fr] gap-2 rounded-lg border border-border/70 bg-background px-2.5 py-2 text-left transition-colors hover:border-border hover:bg-surface-base-faint"
                    href={source.url}
                    key={`${source.position}-${source.url}`}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    <span className="flex size-6 items-center justify-center rounded-md bg-surface-base-subtle font-medium text-content-subtle text-xs">
                      {source.position}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-content-strong text-sm group-hover/source:underline">
                        {source.title || source.url}
                      </span>
                      <span className="block truncate text-content-subtle text-xs">
                        {source.description || formatSourceHost(source.url)}
                      </span>
                    </span>
                  </a>
                ))}
              </div>
            </div>
          )}

          {message.role === "assistant" && audioStream && (
            <AudioStreamPlayer
              chunks={audioChunks}
              className="mt-2"
              descriptor={audioStream}
              live={isLoading}
            />
          )}

          {message.role === "assistant" &&
            (generationStats ||
              responseProof ||
              settlement ||
              streamMetrics) && (
              <ProvenanceChip
                disputeResponseMismatch={disputeResponseMismatch}
                explorerBaseUrl={explorerBaseUrl}
                fallbackWorker={trackedJob?.worker}
                fetchOnChainJob={fetchOnChainJob}
                fetchWorkerStake={fetchWorkerStake}
                hasMismatchEvidence={hasMismatchEvidence}
                jobId={jobId}
                live={isLoading}
                metrics={streamMetrics}
                proof={responseProof}
                settlement={settlement}
                stats={generationStats}
              />
            )}

          {!isReadonly && (
            <MessageActions
              chatId={chatId}
              isLoading={isLoading}
              key={`action-${message.id}`}
              message={message}
              regenerate={
                message.role === "assistant" ? () => regenerate() : undefined
              }
              setMode={setMode}
              vote={vote}
            />
          )}

          {!isReadonly && jobId !== undefined && (
            <MessageJobActions
              jobId={jobId}
              messageRole={message.role as "user" | "assistant"}
              onClaimTimeout={claimJobTimeout}
              onDisputeJob={disputeJob}
              trackedJob={trackedJob}
            />
          )}
        </div>
      </div>
    </motion.div>
  );
};

export const PreviewMessage = memo(
  PurePreviewMessage,
  (prevProps, nextProps) => {
    if (prevProps.isLoading !== nextProps.isLoading) {
      return false;
    }
    if (prevProps.message.id !== nextProps.message.id) {
      return false;
    }
    if (prevProps.requiresScrollPadding !== nextProps.requiresScrollPadding) {
      return false;
    }
    if (!equal(prevProps.message.parts ?? [], nextProps.message.parts ?? [])) {
      return false;
    }
    if (!equal(prevProps.vote, nextProps.vote)) {
      return false;
    }

    return false;
  }
);

const WWW_PREFIX = /^www\./;

function formatSourceHost(url: string): string {
  try {
    return new URL(url).hostname.replace(WWW_PREFIX, "");
  } catch {
    return url;
  }
}

function toCitationSource(source: WebSearchSource): CitationSource {
  return {
    position: source.position,
    title: source.title,
    url: source.url,
    description: source.description,
  };
}

export const ThinkingMessage = ({
  label = "Thinking...",
}: {
  label?: string;
}) => {
  const role = "assistant";

  return (
    <motion.div
      animate={{ opacity: 1 }}
      className="group/message w-full"
      data-role={role}
      data-testid="message-assistant-loading"
      exit={{ opacity: 0, transition: { duration: 0.5 } }}
      initial={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      <div className="flex items-start justify-start gap-3">
        <div className="-mt-1 flex size-8 shrink-0 items-center justify-center rounded-full bg-background ring-1 ring-border">
          {/* <SparklesIcon size={14} /> */}
          <LCAIIcon size={14} />
        </div>

        <div className="flex w-full flex-col gap-2 md:gap-4">
          <Shimmer as="p" duration={2}>
            {label}
          </Shimmer>
        </div>
      </div>
    </motion.div>
  );
};
