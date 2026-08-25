"use client";

import type { UseChatHelpers } from "@ai-sdk/react";
import { Trigger } from "@radix-ui/react-select";
import type { UIMessage } from "ai";
import equal from "fast-deep-equal";
import { Brain } from "lucide-react";
import Image from "next/image";
import { useSession } from "next-auth/react";
import {
  type ChangeEvent,
  type Dispatch,
  memo,
  type SetStateAction,
  startTransition,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { useLocalStorage, useWindowSize } from "usehooks-ts";
import { saveChatModelAsCookie } from "@/app/(chat)/actions";
import { SelectItem } from "@/components/ui/select";
import { useModels } from "@/hooks/use-models";
import { $http } from "@/lib/http";
import type { Attachment, ChatMessage } from "@/lib/types";
import type { AppUsage } from "@/lib/usage";
import { cn } from "@/lib/utils";
import {
  PromptInput,
  PromptInputModelSelect,
  PromptInputModelSelectContent,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputToolbar,
  PromptInputTools,
} from "./elements/prompt-input";
import {
  ArrowUpIcon,
  ChevronDownIcon,
  CpuIcon,
  PaperclipIcon,
  StopIcon,
} from "./icons";
import { PreviewAttachment } from "./preview-attachment";
import { SuggestedActions } from "./suggested-actions";
import { Button } from "./ui/button";
import { Switch } from "./ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import AlertError from "./ui/toast/AlertError";
import type { VisibilityType } from "./visibility-selector";

function PureMultimodalInput({
  chatId,
  input,
  setInput,
  status,
  stop,
  attachments,
  setAttachments,
  messages,
  setMessages,
  sendMessage,
  className,
  selectedVisibilityType,
  selectedModelId,
  onModelChange,
  usage,
  enableWebSearch,
  onWebSearchToggle,
  searchCapable,
  disabled,
  disabledPlaceholder,
  onBeforeSubmit,
  memoryActive,
  onOpenMemory,
}: {
  chatId: string;
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  status: UseChatHelpers<ChatMessage>["status"];
  stop: () => void;
  attachments: Attachment[];
  setAttachments: Dispatch<SetStateAction<Attachment[]>>;
  messages: UIMessage[];
  setMessages: UseChatHelpers<ChatMessage>["setMessages"];
  sendMessage: UseChatHelpers<ChatMessage>["sendMessage"];
  className?: string;
  selectedVisibilityType: VisibilityType;
  selectedModelId: string;
  onModelChange?: (modelId: string) => void;
  usage?: AppUsage;
  enableWebSearch?: boolean;
  onWebSearchToggle?: (enabled: boolean) => void;
  searchCapable?: boolean;
  disabled?: boolean;
  disabledPlaceholder?: string;
  onBeforeSubmit?: () => boolean;
  /**
   * Device-local memory (lib/memory.ts) is enabled and has entries shaping
   * prompts. Indicator only — click opens the memory dialog (chat.tsx).
   */
  memoryActive?: boolean;
  onOpenMemory?: () => void;
}) {
  const session = useSession();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { width } = useWindowSize();

  const adjustHeight = useCallback(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "44px";
    }
  }, []);

  useEffect(() => {
    if (textareaRef.current) {
      adjustHeight();
    }
  }, [adjustHeight]);

  const resetHeight = useCallback(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "44px";
    }
  }, []);

  const [localStorageInput, setLocalStorageInput] = useLocalStorage(
    "input",
    ""
  );

  const canUseChat = session.status === "authenticated";

  useEffect(() => {
    if (textareaRef.current) {
      const domValue = textareaRef.current.value;
      const finalValue = domValue || localStorageInput || "";
      setInput(finalValue);
      adjustHeight();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adjustHeight, localStorageInput, setInput]);

  useEffect(() => {
    setLocalStorageInput(input);
  }, [input, setLocalStorageInput]);

  const handleInput = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(event.target.value);
  };

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadQueue, setUploadQueue] = useState<string[]>([]);

  const submitForm = useCallback(() => {
    if (onBeforeSubmit && !onBeforeSubmit()) {
      return;
    }

    window.history.replaceState({}, "", `/chat/${chatId}`);

    if (status === "error") {
      setMessages((currentMessages) => currentMessages.slice(0, -1));
    }

    sendMessage({
      role: "user",
      parts: [
        ...attachments.map((attachment) => ({
          type: "file" as const,
          url: attachment.url,
          name: attachment.name,
          mediaType: attachment.contentType,
        })),
        {
          type: "text",
          text: input,
        },
      ],
    });

    setAttachments([]);
    setLocalStorageInput("");
    resetHeight();
    setInput("");

    if (width && width > 768) {
      textareaRef.current?.focus();
    }
  }, [
    input,
    setInput,
    attachments,
    sendMessage,
    setAttachments,
    setLocalStorageInput,
    width,
    chatId,
    resetHeight,
    setMessages,
    status,
    onBeforeSubmit,
  ]);

  const uploadFile = useCallback(async (file: File) => {
    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await $http.request("/api/files/upload", {
        method: "POST",
        body: formData,
      });

      if (response.ok) {
        const data = await response.json();
        const { url, pathname, contentType } = data;

        return {
          url,
          name: pathname,
          contentType,
        };
      }
      const { error } = await response.json();
      toast.custom((id) => <AlertError id={id} title={error} />);
    } catch (_error) {
      toast.custom((id) => (
        <AlertError id={id} title="Failed to upload file, please try again!" />
      ));
    }
  }, []);

  const handleFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files || []);

      setUploadQueue(files.map((file) => file.name));

      try {
        const uploadPromises = files.map((file) => uploadFile(file));
        const uploadedAttachments = await Promise.all(uploadPromises);
        const successfullyUploadedAttachments = uploadedAttachments.filter(
          (attachment) => attachment !== undefined
        );

        setAttachments((currentAttachments) => [
          ...currentAttachments,
          ...successfullyUploadedAttachments,
        ]);
      } catch (error) {
        console.error("Error uploading files!", error);
      } finally {
        setUploadQueue([]);
      }
    },
    [setAttachments, uploadFile]
  );

  const showEmptyState =
    messages.length === 0 &&
    attachments.length === 0 &&
    uploadQueue.length === 0 &&
    canUseChat;

  return (
    <div className={cn("relative flex w-full flex-col gap-8", className)}>
      <input
        className="-top-4 -left-4 pointer-events-none fixed size-0.5 opacity-0"
        multiple
        onChange={handleFileChange}
        ref={fileInputRef}
        tabIndex={-1}
        type="file"
      />

      {showEmptyState && (
        <h2 className="text-center font-semibold text-2xl text-content-ultra md:text-3xl xl:text-4xl">
          Start a conversation
        </h2>
      )}

      <PromptInput
        className="border border-bdr-light p-3 transition-all duration-200 sm:p-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (status === "submitted") {
            toast.custom((id) => (
              <AlertError
                id={id}
                title="Please wait for the model to finish its response!"
              />
            ));
          } else {
            submitForm();
          }
        }}
      >
        {(attachments.length > 0 || uploadQueue.length > 0) && (
          <div
            className="flex flex-row items-end gap-2 overflow-x-scroll"
            data-testid="attachments-preview"
          >
            {attachments.map((attachment) => (
              <PreviewAttachment
                attachment={attachment}
                key={attachment.url}
                onRemove={() => {
                  setAttachments((currentAttachments) =>
                    currentAttachments.filter((a) => a.url !== attachment.url)
                  );
                  if (fileInputRef.current) {
                    fileInputRef.current.value = "";
                  }
                }}
              />
            ))}

            {uploadQueue.map((filename) => (
              <PreviewAttachment
                attachment={{
                  url: "",
                  name: filename,
                  contentType: "",
                }}
                isUploading={true}
                key={filename}
              />
            ))}
          </div>
        )}
        <div className="relative flex flex-row items-start gap-1 sm:gap-2">
          <div className="absolute top-[3px] border-surface-base-extraLight border-r pr-2 sm:top-0.5">
            <Image
              alt="Icon"
              height={16}
              src="/images/logo/favicon.png"
              width={16}
            />
          </div>
          <PromptInputTextarea
            autoFocus
            className="grow resize-none border-0! border-none! bg-transparent px-2 pt-0 pb-2 pl-8! text-sm outline-none ring-0 [-ms-overflow-style:none] [scrollbar-width:none] placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 [&::-webkit-scrollbar]:hidden"
            data-testid="multimodal-input"
            disableAutoResize={true}
            disabled={disabled || !canUseChat}
            maxHeight={200}
            minHeight={44}
            onChange={handleInput}
            placeholder={
              disabled && disabledPlaceholder
                ? disabledPlaceholder
                : "Send a message..."
            }
            ref={textareaRef}
            rows={1}
            value={input}
          />{" "}
        </div>
        <PromptInputToolbar className="border-top-0! border-t-0! p-0 shadow-none dark:border-0 dark:border-transparent!">
          <PromptInputTools className="gap-0 sm:gap-0.5">
            <WebSearchToggle
              enabled={enableWebSearch ?? false}
              onToggle={onWebSearchToggle}
              searchCapable={searchCapable ?? false}
            />
            {memoryActive && (
              <Button
                aria-label="Memory is active"
                className="h-8 gap-1.5 rounded-lg px-2 font-normal text-sm"
                data-testid="memory-active-indicator"
                onClick={(event) => {
                  event.preventDefault();
                  onOpenMemory?.();
                }}
                title="Memory is on — your saved notes shape prompts on this device only (nothing is shared with other devices)"
                type="button"
                variant="ghost"
              >
                <Brain className="size-4 text-primary" />
                <span className="rounded bg-primary/10 px-1.5 py-0.5 text-primary text-xs">
                  Memory
                </span>
              </Button>
            )}
            <ModelSelectorCompact
              onModelChange={onModelChange}
              selectedModelId={selectedModelId}
            />
          </PromptInputTools>

          {status === "submitted" ? (
            <StopButton setMessages={setMessages} stop={stop} />
          ) : (
            <PromptInputSubmit
              className="size-8 rounded-full bg-gradient-primary text-white disabled:text-muted-foreground disabled:[background:#c1c1c1] dark:disabled:[background:#303030]"
              disabled={disabled || !input.trim() || uploadQueue.length > 0}
              status={status}
            >
              <ArrowUpIcon size={14} />
            </PromptInputSubmit>
          )}
        </PromptInputToolbar>
      </PromptInput>

      {messages.length === 0 &&
        attachments.length === 0 &&
        uploadQueue.length === 0 &&
        canUseChat &&
        !disabled && (
          <SuggestedActions
            chatId={chatId}
            onBeforeSubmit={onBeforeSubmit}
            selectedVisibilityType={selectedVisibilityType}
            sendMessage={sendMessage}
          />
        )}
    </div>
  );
}

export const MultimodalInput = memo(
  PureMultimodalInput,
  (prevProps, nextProps) => {
    if (prevProps.input !== nextProps.input) {
      return false;
    }
    if (prevProps.status !== nextProps.status) {
      return false;
    }
    if (!equal(prevProps.attachments, nextProps.attachments)) {
      return false;
    }
    if (prevProps.selectedVisibilityType !== nextProps.selectedVisibilityType) {
      return false;
    }
    if (prevProps.selectedModelId !== nextProps.selectedModelId) {
      return false;
    }
    if (prevProps.enableWebSearch !== nextProps.enableWebSearch) {
      return false;
    }
    if (prevProps.searchCapable !== nextProps.searchCapable) {
      return false;
    }
    if (prevProps.disabled !== nextProps.disabled) {
      return false;
    }
    if (prevProps.onBeforeSubmit !== nextProps.onBeforeSubmit) {
      return false;
    }
    if (prevProps.memoryActive !== nextProps.memoryActive) {
      return false;
    }

    return true;
  }
);

function WebSearchToggle({
  enabled,
  onToggle,
  searchCapable,
}: {
  enabled: boolean;
  onToggle?: (enabled: boolean) => void;
  searchCapable: boolean;
}) {
  const inner = (
    <div className="flex items-center gap-2 px-1 py-1">
      <Switch
        checked={searchCapable ? enabled : false}
        className="rounded-full!"
        disabled={!searchCapable}
        onCheckedChange={searchCapable ? onToggle : undefined}
      />
      <span className="text-content-secondary text-sm">Web Search</span>
    </div>
  );

  if (searchCapable) {
    return inner;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{inner}</TooltipTrigger>
      <TooltipContent>
        This conversation&apos;s worker doesn&apos;t support web search. Start a
        new conversation to enable it.
      </TooltipContent>
    </Tooltip>
  );
}

function PureAttachmentsButton({
  fileInputRef,
  status,
  selectedModelId,
}: {
  fileInputRef: React.MutableRefObject<HTMLInputElement | null>;
  status: UseChatHelpers<ChatMessage>["status"];
  selectedModelId: string;
}) {
  const isReasoningModel = selectedModelId === "chat-model-reasoning";

  return (
    <Button
      className="aspect-square h-8 rounded-lg p-1 transition-colors hover:bg-accent"
      data-testid="attachments-button"
      disabled={status !== "ready" || isReasoningModel}
      onClick={(event) => {
        event.preventDefault();
        fileInputRef.current?.click();
      }}
      variant="ghost"
    >
      <PaperclipIcon size={14} style={{ width: 14, height: 14 }} />
    </Button>
  );
}

// biome-ignore lint/correctness/noUnusedVariables: This is used in the future
const AttachmentsButton = memo(PureAttachmentsButton);

function PureModelSelectorCompact({
  selectedModelId,
  onModelChange,
}: {
  selectedModelId: string;
  onModelChange?: (modelId: string) => void;
}) {
  const { models } = useModels();
  const [optimisticModelId, setOptimisticModelId] = useState(selectedModelId);

  useEffect(() => {
    setOptimisticModelId(selectedModelId);
  }, [selectedModelId]);

  const selectedModel = models.find(
    (model) => model.id === optimisticModelId
  );

  return (
    <PromptInputModelSelect
      onValueChange={(modelId) => {
        setOptimisticModelId(modelId);
        onModelChange?.(modelId);
        startTransition(() => {
          saveChatModelAsCookie(modelId);
        });
      }}
      value={selectedModel?.id}
    >
      <Trigger
        className="flex h-8 items-center gap-2 rounded-xl border-0 px-1.5 text-content-default shadow-none transition-colors hover:bg-surface-base-faint focus:outline-none focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0 data-[state=open]:bg-surface-base-faint"
        type="button"
      >
        <CpuIcon size={16} />
        <span className="hidden font-medium text-xs sm:block">
          {selectedModel?.name ?? "Select model"}
        </span>
        <ChevronDownIcon size={16} />
      </Trigger>
      <PromptInputModelSelectContent className="max-w-[300px] rounded-lg p-0">
        <div className="flex flex-col gap-px">
          {models.map((model) => (
            <SelectItem
              className="rounded-lg"
              key={model.id}
              value={model.id}
            >
              <h6 className="mb-0.5 truncate font-medium text-xs">
                {model.name}
              </h6>
            </SelectItem>
          ))}
        </div>
      </PromptInputModelSelectContent>
    </PromptInputModelSelect>
  );
}

const ModelSelectorCompact = memo(PureModelSelectorCompact);

function PureStopButton({
  stop,
  setMessages,
}: {
  stop: () => void;
  setMessages: UseChatHelpers<ChatMessage>["setMessages"];
}) {
  return (
    <Button
      className="size-7 rounded-full bg-foreground p-1 text-background transition-colors duration-200 hover:bg-foreground/90 disabled:bg-muted disabled:text-muted-foreground"
      data-testid="stop-button"
      onClick={(event) => {
        event.preventDefault();
        stop();
        setMessages((messages) => messages);
      }}
    >
      <StopIcon size={14} />
    </Button>
  );
}

const StopButton = memo(PureStopButton);
