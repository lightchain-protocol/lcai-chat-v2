"use client";

import { useMemo } from "react";
import { toast } from "sonner";
import useSWR, { useSWRConfig } from "swr";
import { unstable_serialize } from "swr/infinite";
import {
  type ChatHistory,
  getChatHistoryPaginationKey,
} from "@/components/sidebar-history";
import type { VisibilityType } from "@/components/visibility-selector";
import AlertError from "@/components/ui/toast/AlertError";
import { $http } from "@/lib/http";

export function useChatVisibility({
  chatId,
  initialVisibilityType,
}: {
  chatId: string;
  initialVisibilityType: VisibilityType;
}) {
  const { mutate, cache } = useSWRConfig();
  const history: ChatHistory = cache.get("/api/history")?.data;

  const { data: localVisibility, mutate: setLocalVisibility } = useSWR(
    `${chatId}-visibility`,
    null,
    {
      fallbackData: initialVisibilityType,
    }
  );

  const visibilityType = useMemo(() => {
    if (!history) {
      return localVisibility;
    }
    const chat = history.chats.find((currentChat) => currentChat.id === chatId);
    if (!chat) {
      return "private";
    }
    return chat.visibility;
  }, [history, chatId, localVisibility]);

  const setVisibilityType = async (updatedVisibilityType: VisibilityType) => {
    // Persist through consumer-api, the source of truth that /api/history
    // reads back. Reuses the chat-metadata PATCH that rename already uses
    // (see sidebar-history-item.tsx). Optimistically update local state, then
    // revert and surface the failure if the request does not succeed.
    const previousVisibility = visibilityType;
    setLocalVisibility(updatedVisibilityType);

    const response = await $http.patch(`/api/chat?id=${chatId}`, {
      visibility: updatedVisibilityType,
    });

    if (!response.ok) {
      setLocalVisibility(previousVisibility);
      toast.custom((id) => (
        <AlertError id={id} title="Failed to update chat visibility" />
      ));
      return;
    }

    mutate(unstable_serialize(getChatHistoryPaginationKey));
  };

  return { visibilityType, setVisibilityType };
}
