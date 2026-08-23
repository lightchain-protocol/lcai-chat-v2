"use client";

import type { UseChatHelpers } from "@ai-sdk/react";
import { Trigger } from "@radix-ui/react-select";
import type { UIMessage } from "ai";
import equal from "fast-deep-equal";
import { Globe, Mic, Square, Swords, Volume2 } from "lucide-react";
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
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { useLocalStorage, useWindowSize } from "usehooks-ts";
import { saveChatModelAsCookie } from "@/app/(chat)/actions";
import { SelectItem } from "@/components/ui/select";
import { AUTO_MODEL_ID, type AutoRoute } from "@/lib/ai/auto-route";
import {
  chatModels,
  formatFee,
  getChatModel,
  groupModelsBySpecialty,
  modelSpecialty,
  modelSpeed,
  modelSupportsImages,
  modelSupportsVoice,
  starterPrompts,
} from "@/lib/ai/models";
import { MAX_VOICE_CLIP_SECONDS } from "@/lib/audio/pcm";
import {
  startVoiceRecording,
  type VoiceClip,
  type VoiceRecorder,
} from "@/lib/audio/voice-recorder";
import {
  checkImageBudget,
  downscaleImageToBase64,
  stripDataUrlPrefix,
} from "@/lib/protocol/prompt-envelope";
import {
  DEFAULT_WEB_SEARCH_MODE,
  type WebSearchMode,
} from "@/lib/protocol/search-intent";
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
import { Button } from "./ui/button";
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
  selectedModelId,
  onModelChange,
  usage,
  webSearchMode,
  onWebSearchModeChange,
  speakResponses,
  onSpeakResponsesChange,
  disabled,
  disabledPlaceholder,
  onBeforeSubmit,
  onDuel,
  autoRoute,
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
  webSearchMode?: WebSearchMode;
  onWebSearchModeChange?: (mode: WebSearchMode) => void;
  /**
   * "Speak responses" opt-in (envelope v2 audioResponse). Only rendered for
   * voice-capable models; owned by chat.tsx so it survives composer remounts.
   */
  speakResponses?: boolean;
  onSpeakResponsesChange?: (enabled: boolean) => void;
  disabled?: boolean;
  disabledPlaceholder?: string;
  /**
   * Pre-send guard. Returns false to block the send (e.g. no wallet connected
   * or an unfunded/undelegated prepaid balance), in which case it is expected
   * to surface the relevant modal. When it returns false the typed input and
   * attachments are preserved so the user can resend after resolving the issue.
   */
  onBeforeSubmit?: () => boolean;
  /**
   * Multi-model duel entry (bc-2 §1, protocol mode only). Called with the
   * current trimmed prompt; chat.tsx opens the side-B picker. Undefined hides
   * the button entirely — no teasing a feature the mode can't fund.
   */
  onDuel?: (prompt: string) => void;
  /** Last auto-routing decision, for the "auto → {model} · {reason}" line. */
  autoRoute?: AutoRoute | null;
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
      // Prefer DOM value over localStorage to handle hydration
      const finalValue = domValue || localStorageInput || "";
      setInput(finalValue);
      adjustHeight();
    }
    // Only run once after hydration
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

  // Voice-prompt recording. The clip lands as an in-memory audio/wav
  // attachment — like images, it travels inside the encrypted prompt blob
  // rather than via any uploaded URL.
  const recorderRef = useRef<VoiceRecorder | null>(null);
  const recordStartedAtRef = useRef<number>(0);
  const [recordingElapsed, setRecordingElapsed] = useState<number | null>(null);
  const isRecording = recordingElapsed !== null;

  const finalizeClip = useCallback(
    (clipPromise: Promise<VoiceClip>) => {
      clipPromise
        .then((clip) => {
          setAttachments((current) => [
            ...current,
            {
              url: `data:audio/wav;base64,${clip.wavBase64}`,
              name: `Voice prompt (${clip.seconds.toFixed(1)}s)`,
              contentType: "audio/wav",
            },
          ]);
        })
        .catch((error) => {
          console.error("Voice recording failed", error);
          toast.custom((id) => (
            <AlertError id={id} title="Could not use that recording." />
          ));
        })
        .finally(() => {
          recorderRef.current = null;
          setRecordingElapsed(null);
        });
    },
    [setAttachments]
  );

  const startRecording = useCallback(async () => {
    try {
      const recorder = await startVoiceRecording({
        onAutoStop: (clipPromise) => finalizeClip(clipPromise),
      });
      recorderRef.current = recorder;
      recordStartedAtRef.current = Date.now();
      setRecordingElapsed(0);
    } catch (error) {
      console.error("Microphone unavailable", error);
      toast.custom((id) => (
        <AlertError
          id={id}
          title="Microphone unavailable — check browser permission."
        />
      ));
    }
  }, [finalizeClip]);

  const stopRecording = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    finalizeClip(recorder.stop());
  }, [finalizeClip]);

  // Elapsed-time ticker while recording.
  useEffect(() => {
    if (!isRecording) return;
    const timer = setInterval(() => {
      setRecordingElapsed((Date.now() - recordStartedAtRef.current) / 1000);
    }, 200);
    return () => clearInterval(timer);
  }, [isRecording]);

  // Abandon an unfinished recording on unmount rather than leaking the mic.
  useEffect(() => {
    return () => recorderRef.current?.cancel();
  }, []);

  const submitForm = useCallback(() => {
    // Gate before mutating any state so a blocked send leaves the typed message
    // and attachments intact for resend after the user funds / authorizes.
    if (onBeforeSubmit && !onBeforeSubmit()) {
      return;
    }

    window.history.replaceState({}, "", `/chat/${chatId}`);

    if (status === "error") {
      setMessages((currentMessages) => currentMessages.slice(0, -1)); // remove last message if error
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

  /**
   * Prepares an image for sending without uploading it anywhere.
   *
   * An attachment is part of the prompt, so it travels inside the encrypted
   * blob like the text does. Uploading it to object storage first would put
   * the user's image behind a public URL, which contradicts the end-to-end
   * encryption the rest of this path is built around.
   *
   * Downscaling is not optional: the prompt blob is capped at 126,972 bytes,
   * and a phone photo is an order of magnitude over that on its own.
   */
  const prepareImage = useCallback(async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.custom((id) => (
        <AlertError
          id={id}
          title={`${file.name} is not an image. Only images can be sent to a vision model.`}
        />
      ));
      return;
    }
    try {
      const base64 = await downscaleImageToBase64(file);
      return {
        url: `data:image/jpeg;base64,${base64}`,
        name: file.name,
        contentType: "image/jpeg",
      };
    } catch (error) {
      console.error("Failed to prepare image", error);
      toast.custom((id) => (
        <AlertError id={id} title={`Could not read ${file.name}.`} />
      ));
    }
  }, []);

  // const _modelResolver = useMemo(() => {
  //   return myProvider.languageModel(selectedModelId);
  // }, [selectedModelId]);

  // const contextProps = useMemo(
  //   () => ({
  //     usage,
  //     subscriptionTier,
  //   }),
  //   [usage, subscriptionTier]
  // );

  const handleFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files || []);

      setUploadQueue(files.map((file) => file.name));

      try {
        const prepared = (await Promise.all(files.map(prepareImage))).filter(
          (attachment) => attachment !== undefined
        );

        const next = [...attachments, ...prepared];
        // Reject the whole batch rather than sending a prompt that will fail
        // on chain after the consumer has already been charged for it.
        const budgetError = checkImageBudget(
          next.map((a) => stripDataUrlPrefix(a.url))
        );
        if (budgetError) {
          toast.custom((id) => <AlertError id={id} title={budgetError} />);
          return;
        }
        setAttachments(next);
      } catch (error) {
        console.error("Error preparing attachments", error);
      } finally {
        setUploadQueue([]);
        // Clearing the input lets the same file be picked again after a
        // removal, which otherwise silently does nothing.
        event.target.value = "";
      }
    },
    [attachments, prepareImage, setAttachments]
  );

  const showEmptyState =
    messages.length === 0 &&
    attachments.length === 0 &&
    uploadQueue.length === 0 &&
    canUseChat;

  return (
    <div className={cn("relative flex w-full flex-col gap-8", className)}>
      <input
        // Only vision models exist in this fleet; anything else would be
        // encrypted into the prompt and then ignored by the model.
        accept="image/*"
        className="-top-4 -left-4 pointer-events-none fixed size-0.5 opacity-0"
        multiple
        onChange={handleFileChange}
        ref={fileInputRef}
        tabIndex={-1}
        type="file"
      />

      {showEmptyState && (
        <div className="flex flex-col items-center gap-4">
          <h2 className="text-center font-semibold text-2xl text-content-ultra md:text-3xl xl:text-4xl">
            Start a conversation
          </h2>
          {/* Starters are chosen for the selected model, so a coding model
              suggests code and a vision model asks for an image. A blank box
              with no examples was the entire authenticated empty state. */}
          <div className="flex flex-wrap justify-center gap-2">
            {starterPrompts(selectedModelId).map((prompt) => (
              <button
                className="rounded-full border border-bdr-light px-3 py-1.5 text-content-default text-xs transition-colors hover:bg-surface-base-faint disabled:opacity-50"
                disabled={disabled || !canUseChat}
                key={prompt}
                onClick={() => {
                  setInput(prompt);
                  textareaRef.current?.focus();
                }}
                type="button"
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>
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
        {selectedModelId === AUTO_MODEL_ID && autoRoute && (
          <p
            className="px-2 pb-1 text-content-light text-xs"
            data-testid="auto-route-reveal"
          >
            auto → {getChatModel(autoRoute.modelId)?.name ?? autoRoute.modelId}{" "}
            · {autoRoute.reason}
          </p>
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
          {/* <Context {...contextProps} /> */}
        </div>
        <PromptInputToolbar className="border-top-0! border-t-0! p-0 shadow-none dark:border-0 dark:border-transparent!">
          <PromptInputTools className="gap-0 sm:gap-0.5">
            {(modelSupportsImages(selectedModelId) ||
              selectedModelId === AUTO_MODEL_ID) && (
              <AttachmentsButton fileInputRef={fileInputRef} status={status} />
            )}
            {modelSupportsVoice(selectedModelId) && (
              <>
                <VoiceRecordButton
                  elapsed={recordingElapsed}
                  isRecording={isRecording}
                  onStart={startRecording}
                  onStop={stopRecording}
                  status={status}
                />
                <SpeakResponsesToggle
                  enabled={speakResponses ?? false}
                  onChange={onSpeakResponsesChange}
                />
              </>
            )}
            <WebSearchToggle
              mode={webSearchMode ?? DEFAULT_WEB_SEARCH_MODE}
              onModeChange={onWebSearchModeChange}
            />
            {onDuel && (
              <Button
                className="h-8 gap-1.5 rounded-lg px-2 font-normal text-sm"
                data-testid="duel-button"
                disabled={
                  status !== "ready" ||
                  !input.trim() ||
                  attachments.length > 0 ||
                  isRecording
                }
                onClick={() => onDuel(input.trim())}
                title={
                  attachments.length > 0
                    ? "Duels are text-only for now — remove attachments to compare models."
                    : "Duel: send this prompt to a second model and compare side by side (2 paid jobs)."
                }
                type="button"
                variant="ghost"
              >
                <Swords className="size-4" />
                <span className="hidden sm:block">Duel</span>
              </Button>
            )}
            <ModelSelectorCompact
              onModelChange={onModelChange}
              selectedModelId={selectedModelId}
            />
          </PromptInputTools>

          {/* Also while streaming, not just while submitted. A long answer
              from a 40 tok/s model runs for tens of seconds, and until now
              there was no way to cut it short. */}
          {status === "submitted" || status === "streaming" ? (
            <StopButton setMessages={setMessages} stop={stop} />
          ) : (
            <PromptInputSubmit
              className="size-8 rounded-full bg-gradient-primary text-white disabled:text-muted-foreground disabled:[background:#c1c1c1] dark:disabled:[background:#303030]"
              disabled={
                disabled ||
                isRecording ||
                (!input.trim() && attachments.length === 0) ||
                uploadQueue.length > 0
              }
              status={status}
            >
              <ArrowUpIcon size={14} />
            </PromptInputSubmit>
          )}
        </PromptInputToolbar>
      </PromptInput>
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
    if (prevProps.webSearchMode !== nextProps.webSearchMode) {
      return false;
    }
    if (prevProps.speakResponses !== nextProps.speakResponses) {
      return false;
    }
    if (prevProps.disabled !== nextProps.disabled) {
      return false;
    }
    // Re-render when the send guard changes identity so submitForm captures the
    // latest readiness closure instead of a stale one.
    if (prevProps.onBeforeSubmit !== nextProps.onBeforeSubmit) {
      return false;
    }
    if (prevProps.onDuel !== nextProps.onDuel) {
      return false;
    }
    if (!equal(prevProps.autoRoute, nextProps.autoRoute)) {
      return false;
    }

    return true;
  }
);

const WEB_SEARCH_LABELS: Record<WebSearchMode, string> = {
  auto: "Auto",
  on: "On",
  off: "Off",
};

const WEB_SEARCH_TITLES: Record<WebSearchMode, string> = {
  auto: "Web search: Auto — runs only when the question needs current information. Click to always search.",
  on: "Web search: On — every prompt is searched. Click to never search.",
  off: "Web search: Off — never searches. Click to go back to Auto.",
};

const NEXT_WEB_SEARCH_MODE: Record<WebSearchMode, WebSearchMode> = {
  auto: "on",
  on: "off",
  off: "auto",
};

/**
 * Per-message web-search control. Search is resolved in the browser and folded
 * into the prompt before it is encrypted, so it works with every model and no
 * longer depends on the bound worker advertising a "search" capability.
 *
 * Three states rather than two: Auto is the default and lets the prompt decide,
 * while On and Off are the manual overrides for when it decides wrongly.
 */
function WebSearchToggle({
  mode,
  onModeChange,
}: {
  mode: WebSearchMode;
  onModeChange?: (mode: WebSearchMode) => void;
}) {
  return (
    <Button
      className="h-8 gap-1.5 rounded-lg px-2 font-normal text-sm"
      data-testid="web-search-toggle"
      onClick={() => onModeChange?.(NEXT_WEB_SEARCH_MODE[mode])}
      title={WEB_SEARCH_TITLES[mode]}
      type="button"
      variant="ghost"
    >
      <Globe className={cn("size-4", mode === "off" && "opacity-40")} />
      <span className="text-content-secondary">Web Search</span>
      <span
        className={cn(
          "rounded px-1.5 py-0.5 text-xs",
          mode === "on" && "bg-primary/10 text-primary",
          mode === "auto" && "bg-muted text-content-secondary",
          mode === "off" && "text-content-secondary opacity-60"
        )}
      >
        {WEB_SEARCH_LABELS[mode]}
      </span>
    </Button>
  );
}

// The caller only renders this for models that can read an image, so there is
// no model check here — see modelSupportsImages in lib/ai/models.
function PureAttachmentsButton({
  fileInputRef,
  status,
}: {
  fileInputRef: React.MutableRefObject<HTMLInputElement | null>;
  status: UseChatHelpers<ChatMessage>["status"];
}) {
  return (
    <Button
      aria-label="Attach an image"
      className="aspect-square h-8 rounded-lg p-1 transition-colors hover:bg-accent"
      data-testid="attachments-button"
      disabled={status !== "ready"}
      onClick={(event) => {
        event.preventDefault();
        fileInputRef.current?.click();
      }}
      title="Attach an image"
      variant="ghost"
    >
      <PaperclipIcon size={14} style={{ width: 14, height: 14 }} />
    </Button>
  );
}

const AttachmentsButton = memo(PureAttachmentsButton);

/**
 * Mic button for voice prompts, shown only for voice-capable models (the
 * caller gates on modelSupportsVoice). Recording is hard-capped at
 * MAX_VOICE_CLIP_SECONDS by the envelope's audio budget — the button shows
 * the countdown so the cutoff never surprises.
 */
function PureVoiceRecordButton({
  isRecording,
  elapsed,
  onStart,
  onStop,
  status,
}: {
  isRecording: boolean;
  elapsed: number | null;
  onStart: () => void;
  onStop: () => void;
  status: UseChatHelpers<ChatMessage>["status"];
}) {
  if (isRecording) {
    const remaining = Math.max(
      0,
      MAX_VOICE_CLIP_SECONDS - Math.floor(elapsed ?? 0)
    );
    return (
      <Button
        aria-label="Stop recording"
        className="h-8 gap-1.5 rounded-lg px-2 font-normal text-sm"
        data-testid="voice-record-stop"
        onClick={(event) => {
          event.preventDefault();
          onStop();
        }}
        title={`Stop recording (auto-stops at ${MAX_VOICE_CLIP_SECONDS}s — the per-prompt audio limit)`}
        type="button"
        variant="ghost"
      >
        <span className="relative flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-red-500 opacity-75" />
          <span className="relative inline-flex size-2 rounded-full bg-red-500" />
        </span>
        <span className="text-content-secondary tabular-nums">
          {remaining}s
        </span>
        <Square size={12} />
      </Button>
    );
  }
  return (
    <Button
      aria-label="Record a voice prompt"
      className="aspect-square h-8 rounded-lg p-1 transition-colors hover:bg-accent"
      data-testid="voice-record-button"
      disabled={status !== "ready"}
      onClick={(event) => {
        event.preventDefault();
        onStart();
      }}
      title={`Record a voice prompt (up to ${MAX_VOICE_CLIP_SECONDS}s, transcribed by the worker)`}
      type="button"
      variant="ghost"
    >
      <Mic size={14} style={{ width: 14, height: 14 }} />
    </Button>
  );
}

const VoiceRecordButton = memo(PureVoiceRecordButton);

/**
 * "Speak responses" opt-in: sets the envelope's audioResponse flag so the
 * worker streams a synthesized voice answer alongside the text. Off by
 * default — audio costs the worker synthesis time inside the job deadline.
 */
function PureSpeakResponsesToggle({
  enabled,
  onChange,
}: {
  enabled: boolean;
  onChange?: (enabled: boolean) => void;
}) {
  return (
    <Button
      aria-label="Toggle spoken responses"
      className="h-8 gap-1.5 rounded-lg px-2 font-normal text-sm"
      data-testid="speak-responses-toggle"
      onClick={(event) => {
        event.preventDefault();
        onChange?.(!enabled);
      }}
      title="Speak responses: the worker synthesizes the answer as audio (delivered live, not settled on-chain)"
      type="button"
      variant="ghost"
    >
      <Volume2 className={cn("size-4", !enabled && "opacity-40")} />
      <span
        className={cn(
          "rounded px-1.5 py-0.5 text-xs",
          enabled
            ? "bg-primary/10 text-primary"
            : "text-content-secondary opacity-60"
        )}
      >
        {enabled ? "Speaking" : "Muted"}
      </span>
    </Button>
  );
}

const SpeakResponsesToggle = memo(PureSpeakResponsesToggle);

function PureModelSelectorCompact({
  selectedModelId,
  onModelChange,
}: {
  selectedModelId: string;
  onModelChange?: (modelId: string) => void;
}) {
  const [optimisticModelId, setOptimisticModelId] = useState(selectedModelId);
  const [query, setQuery] = useState("");

  useEffect(() => {
    setOptimisticModelId(selectedModelId);
  }, [selectedModelId]);

  const selectedModel = chatModels.find(
    (model) => model.id === optimisticModelId
  );

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matching = needle
      ? chatModels.filter(
          (m) =>
            m.name.toLowerCase().includes(needle) ||
            m.description.toLowerCase().includes(needle) ||
            modelSpecialty(m.id).toLowerCase().includes(needle)
        )
      : chatModels;
    return groupModelsBySpecialty(matching);
  }, [query]);

  return (
    <PromptInputModelSelect
      onValueChange={(modelName) => {
        // "Auto" is a routing mode, not a model — it never touches the cookie
        // so a fresh session can't boot into an id no model list knows.
        if (modelName === "Auto") {
          setOptimisticModelId(AUTO_MODEL_ID);
          onModelChange?.(AUTO_MODEL_ID);
          return;
        }
        const model = chatModels.find((m) => m.name === modelName);
        if (model) {
          setOptimisticModelId(model.id);
          onModelChange?.(model.id);
          startTransition(() => {
            saveChatModelAsCookie(model.id);
          });
        }
      }}
      value={optimisticModelId === AUTO_MODEL_ID ? "Auto" : selectedModel?.name}
    >
      <Trigger
        className="flex h-8 items-center gap-2 rounded-xl border-0 px-1.5 text-content-default shadow-none transition-colors hover:bg-surface-base-faint focus:outline-none focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0 data-[state=open]:bg-surface-base-faint"
        type="button"
      >
        <CpuIcon size={16} />
        <span className="hidden font-medium text-xs sm:block">
          {optimisticModelId === AUTO_MODEL_ID ? "Auto" : selectedModel?.name}
        </span>
        {selectedModel && (
          <span
            className="hidden text-content-subtle text-xs sm:block"
            title="Cost of one prompt with this model"
          >
            {formatFee(selectedModel.fee)}
          </span>
        )}
        <ChevronDownIcon size={16} />
      </Trigger>
      <PromptInputModelSelectContent className="max-w-[340px] rounded-lg p-0">
        {/* Seventeen models in a flat list ran off the bottom of the viewport,
            which is why this is grouped and filterable rather than a plain
            list. Fee and speed are on each row because they are what people
            actually choose on. */}
        <div className="border-bdr-light border-b p-1.5">
          <input
            className="w-full rounded-md bg-surface-base-faint px-2 py-1 text-xs outline-none placeholder:text-content-subtle"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            placeholder="Search models"
            value={query}
          />
        </div>
        <div className="flex max-h-[320px] flex-col gap-px overflow-y-auto p-1">
          {groups.length === 0 && (
            <p className="px-2 py-3 text-center text-content-subtle text-xs">
              No model matches &ldquo;{query}&rdquo;
            </p>
          )}
          <SelectItem
            className="rounded-lg py-1"
            title="Picks the model per prompt: images go to vision, code to the coder, long prompts to the long-context model, everything else to the fastest warm model. The pick is shown before the answer streams."
            value="Auto"
          >
            <span className="flex w-full items-baseline justify-between gap-2">
              <span className="truncate font-medium text-xs">Auto</span>
              <span className="shrink-0 text-[10px] text-content-subtle">
                routed per prompt
              </span>
            </span>
          </SelectItem>
          {groups.map((group) => (
            <div key={group.specialty}>
              <p className="px-2 pt-2 pb-1 font-medium text-[10px] text-content-subtle uppercase tracking-wide">
                {group.specialty}
              </p>
              {group.models.map((model) => (
                <SelectItem
                  className="rounded-lg py-1"
                  key={model.id}
                  title={model.description}
                  value={model.name}
                >
                  <span className="flex w-full items-baseline justify-between gap-2">
                    <span className="truncate font-medium text-xs">
                      {model.name}
                    </span>
                    <span className="shrink-0 text-[10px] text-content-subtle">
                      {modelSpeed(model.id)} · {formatFee(model.fee)}
                    </span>
                  </span>
                </SelectItem>
              ))}
            </div>
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
