import equal from "fast-deep-equal";
import { memo, useState } from "react";
import { toast } from "sonner";
import { useSWRConfig } from "swr";
import { useCopyToClipboard } from "usehooks-ts";
import type { Vote } from "@/lib/db/schema";
import type { ChatMessage } from "@/lib/types";
import { Action, Actions } from "./elements/actions";
import { Copy, CopyCheck, Loader, Pencil, ThumbsDown, ThumbsUp } from "lucide-react";
import AlertError from "./ui/toast/AlertError";
import AlertInfo from "./ui/toast/AlertInfo";

export function PureMessageActions({
  chatId,
  message,
  vote,
  isLoading,
  setMode,
}: {
  chatId: string;
  message: ChatMessage;
  vote: Vote | undefined;
  isLoading: boolean;
  setMode?: (mode: "view" | "edit") => void;
}) {
  const { mutate } = useSWRConfig();
  const [_, copyToClipboard] = useCopyToClipboard();

  if (isLoading) {
    return null;
  }

  const textFromParts = message.parts
    ?.filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();

  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
  if (!textFromParts) {
    toast.custom(() => (
      <AlertError title="There's no text to copy!" description="Please try again" />
    ));
    return;
  }

  await copyToClipboard(textFromParts);
  setCopied(true);
  setTimeout(() => setCopied(false), 1200);
};


  // User messages get edit (on hover) and copy actions
  if (message.role === "user") {
    return (
      <Actions className="-mr-0.5 justify-end">
        <div className="relative">
          {setMode && (
            <Action
              className="-left-10 absolute top-0 opacity-0 transition-opacity group-hover/message:opacity-100"
              onClick={() => setMode("edit")}
              tooltip="Edit"
            >
              <Pencil />
            </Action>
          )}
          <Action onClick={handleCopy} tooltip="Copy">
            {copied ? <CopyCheck /> : <Copy />}
          </Action>

        </div>
      </Actions>
    );
  }

  return (
    <Actions className="-ml-0.5">
      <Action onClick={handleCopy} tooltip="Copy">
        {copied ? <CopyCheck /> : <Copy />}
      </Action>

      <Action
        data-testid="message-upvote"
        onClick={() => {
          const upvote = fetch("/api/vote", {
            method: "PATCH",
            body: JSON.stringify({
              chatId,
              messageId: message.id,
              type: "up",
            }),
          });

          toast.promise(upvote, {
            loading: (
            <AlertInfo
              title="Upvoting Response..."
              icon={<Loader className="size-5 animate-spin text-white" />}
            />
          ),

          success: () => {
            mutate<Vote[]>(
              `/api/vote?chatId=${chatId}`,
              (currentVotes) => {
                if (!currentVotes) {
                  return [];
                }

                const votesWithoutCurrent = currentVotes.filter(
                  (currentVote) => currentVote.messageId !== message.id
                );

                return [
                  ...votesWithoutCurrent,
                  {
                    chatId,
                    messageId: message.id,
                    isUpvoted: true,
                  },
                ];
              },
              { revalidate: false }
            );
          return  <AlertInfo title="Upvoted Response!" /> ;
          },
          error: (
            <AlertError
              title="Failed to upvote response."
            />
          ),

          style: {
            background: "transparent",
            padding: 0,
            border: "none",
            boxShadow: "none",
          },
          });
        }}
        tooltip="Upvote Response"
      >
        {vote?.isUpvoted ? <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M10.0723 1.93506C10.5388 1.94084 10.9985 2.05207 11.416 2.26025C11.8333 2.46842 12.1981 2.76824 12.4834 3.13721C12.7686 3.50619 12.9671 3.93481 13.0635 4.39111C13.1595 4.84623 13.1509 5.31735 13.04 5.76904L12.5684 7.71924H15.7227C16.0765 7.71924 16.4257 7.80126 16.7422 7.95947C17.0585 8.11765 17.3337 8.34753 17.5459 8.63037C17.7581 8.91337 17.9025 9.24234 17.9658 9.59033C18.029 9.93828 18.0101 10.2967 17.9111 10.6362L16.2266 16.4204C16.0885 16.8937 15.8006 17.3101 15.4062 17.606C15.0118 17.9018 14.5312 18.062 14.0381 18.062H4.2793C3.67484 18.062 3.09441 17.8214 2.66699 17.394C2.23981 16.9667 2.00009 16.387 2 15.7827V9.99854C2 9.3941 2.23965 8.8137 2.66699 8.38623C3.09441 7.95881 3.67483 7.71924 4.2793 7.71924H6.27344C6.38712 7.71918 6.49901 7.68724 6.5957 7.62744C6.69242 7.56746 6.77153 7.4813 6.82227 7.37939L6.82324 7.37646L9.31738 2.39502L9.37793 2.29346C9.5341 2.06815 9.79311 1.93174 10.0723 1.93506Z" fill="url(#paint0_linear_40000558_801)"/>
        <defs>
        <linearGradient id="paint0_linear_40000558_801" x1="18.0024" y1="9.99856" x2="2" y2="9.99856" gradientUnits="userSpaceOnUse">
        <stop stopColor="#7064E9"/>
        <stop offset="1" stopColor="#DD00AC"/>
        </linearGradient>
        </defs>
        </svg> : <ThumbsUp />}
      </Action>

      <Action
        data-testid="message-downvote"
        disabled={vote && !vote.isUpvoted}
        onClick={() => {
          const downvote = fetch("/api/vote", {
            method: "PATCH",
            body: JSON.stringify({
              chatId,
              messageId: message.id,
              type: "down",
            }),
          });

          toast.promise(downvote, {
            loading: (
            <AlertInfo
              title="Downvoting Response..."
              icon={<Loader className="size-5 animate-spin text-white" />}
            />
          ),

            success: () => {
              mutate<Vote[]>(
                `/api/vote?chatId=${chatId}`,
                (currentVotes) => {
                  if (!currentVotes) {
                    return [];
                  }

                  const votesWithoutCurrent = currentVotes.filter(
                    (currentVote) => currentVote.messageId !== message.id
                  );

                  return [
                    ...votesWithoutCurrent,
                    {
                      chatId,
                      messageId: message.id,
                      isUpvoted: false,
                    },
                  ];
                },
                { revalidate: false }
              );

              return <AlertInfo
              title="Downvoted Response!"
            /> ;
            },
            error: <AlertError
              title="Failed to downvote response."
            /> ,

            style: {
              background: "transparent",
              padding: 0,
              border: "none",
              boxShadow: "none",
            },
            
          });
        }}
        tooltip="Downvote Response"
      >
        {vote && !vote.isUpvoted ? <svg className="text-content-light" width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M15.7168 1.93994C16.3208 1.94005 16.9 2.17989 17.3271 2.60693C17.7544 3.03426 17.9951 3.61399 17.9951 4.21826V9.99951C17.9951 10.6038 17.7544 11.1835 17.3271 11.6108C16.9 12.038 16.3209 12.2787 15.7168 12.2788H13.7227L13.6377 12.2847C13.5539 12.2965 13.4729 12.3257 13.4004 12.3706C13.3039 12.4305 13.2254 12.5159 13.1748 12.6177L13.1738 12.6206L10.6807 17.5991C10.5378 17.8845 10.2449 18.0639 9.92578 18.0601C9.45954 18.0543 9.00029 17.9429 8.58301 17.7349C8.16573 17.5268 7.80083 17.2268 7.51562 16.8579C7.23042 16.489 7.03186 16.0603 6.93555 15.604C6.83928 15.1479 6.84731 14.6758 6.95898 14.2231L7.43066 12.2788H4.27832C3.92461 12.2788 3.57515 12.1958 3.25879 12.0376C2.94259 11.8794 2.6672 11.6496 2.45508 11.3667C2.24305 11.0839 2.09941 10.7555 2.03613 10.4077C1.97289 10.0597 1.99182 9.70136 2.09082 9.36182L3.77441 3.58057L3.83301 3.40576C3.98594 3.00503 4.24961 2.6539 4.59473 2.39502C4.98905 2.09932 5.46903 1.93996 5.96191 1.93994H15.7168Z" fill="currentColor"/>
          </svg>
          : <ThumbsDown />}
      </Action>
    </Actions>
  );
}

export const MessageActions = memo(
  PureMessageActions,
  (prevProps, nextProps) => {
    if (!equal(prevProps.vote, nextProps.vote)) {
      return false;
    }
    if (prevProps.isLoading !== nextProps.isLoading) {
      return false;
    }

    return true;
  }
);
