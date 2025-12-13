"use client";
import type { UseChatHelpers } from "@ai-sdk/react";
import equal from "fast-deep-equal";
import { motion } from "framer-motion";
import { memo, useMemo, useState } from "react";
import { useIsClient } from "usehooks-ts";
import type { Vote } from "@/lib/db/schema";
import type { ChatMessage } from "@/lib/types";
import { cn, sanitizeText } from "@/lib/utils";
import { Shimmer } from "./ai-elements/shimmer";
import { CitationResponse, type CitationSource } from "./citation-response";
import { useDataStream } from "./data-stream-provider";
import { MessageContent } from "./elements/message";
import { Response } from "./elements/response";
import { LCAIIcon } from "./icons";
import { MessageActions } from "./message-actions";
import { MessageEditor } from "./message-editor";
import { MessageReasoning } from "./message-reasoning";
import { PreviewAttachment } from "./preview-attachment";
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
}: {
  chatId: string;
  message: ChatMessage;
  vote: Vote | undefined;
  isLoading: boolean;
  setMessages: UseChatHelpers<ChatMessage>["setMessages"];
  regenerate: UseChatHelpers<ChatMessage>["regenerate"];
  isReadonly: boolean;
  requiresScrollPadding: boolean;
}) => {
  const [mode, setMode] = useState<"view" | "edit">("view");
  const isClient = useIsClient();

  const attachmentsFromMessage = message.parts.filter(
    (part) => part.type === "file"
  );

  // Collect all search results from webSearch tool calls
  const searchResults = useMemo(() => {
    const results: CitationSource[] = [];

    for (const part of message.parts) {
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
  }, [message.parts]);

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
            "gap-2 md:gap-4": message.parts?.some(
              (p) => p.type === "text" && p.text?.trim()
            ),
            "min-h-96": message.role === "assistant" && requiresScrollPadding,
            "w-full":
              (message.role === "assistant" &&
                message.parts?.some(
                  (p) => p.type === "text" && p.text?.trim()
                )) ||
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

          {message.parts?.map((part, index) => {
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

            if (type === "text") {
              if (mode === "view") {
                return (
                  <div key={key}>
                    <MessageContent
                      className={cn({
                        "wrap-break-word w-fit rounded-2xl px-3 py-2 bg-surface-m-light text-content-primary":
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
                          {replaceCitations(sanitizeText(part.text))}
                        </Response>
                      ) : (
                        <Response>{sanitizeText(part.text)}</Response>
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

          {!isReadonly && (
            <MessageActions
              chatId={chatId}
              isLoading={isLoading}
              key={`action-${message.id}`}
              message={message}
              setMode={setMode}
              vote={vote}
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
    if (!equal(prevProps.message.parts, nextProps.message.parts)) {
      return false;
    }
    if (!equal(prevProps.vote, nextProps.vote)) {
      return false;
    }

    return false;
  }
);

export const ThinkingMessage = () => {
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
            Thinking...
          </Shimmer>
        </div>
      </div>
    </motion.div>
  );
};
