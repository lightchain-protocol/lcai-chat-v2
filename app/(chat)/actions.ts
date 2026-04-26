"use server";

import { generateText, type UIMessage } from "ai";
import { cookies } from "next/headers";
import { auth } from "@/app/(auth)/auth";
import type { VisibilityType } from "@/components/visibility-selector";
import { myProvider } from "@/lib/ai/providers";
import {
  deleteMessagesByChatIdAfterTimestamp,
  getChatById,
  getMessageById,
  updateChatVisiblityById,
} from "@/lib/db/queries";
import { ChatSDKError } from "@/lib/errors";

export async function saveChatModelAsCookie(model: string) {
  const cookieStore = await cookies();
  cookieStore.set("chat-model", model);
}

export async function generateTitleFromUserMessage({
  message,
}: {
  message: UIMessage;
}) {
  const session = await auth();

  if (!session?.user) {
    throw new ChatSDKError("unauthorized:chat");
  }

  const { text: title } = await generateText({
    model: myProvider.languageModel("title-model"),
    system: `\n
    - you will generate a short title based on the first message a user begins a conversation with
    - ensure it is not more than 80 characters long
    - the title should be a summary of the user's message
    - do not use quotes or colons`,
    prompt: JSON.stringify(message),
    maxOutputTokens: 80, // 80 characters is the maximum length of a title
    temperature: 0.3,
    stopSequences: ["<|im_end|>"],
  });

  return title;
}

export async function deleteTrailingMessages({ id }: { id: string }) {
  const session = await auth();

  if (!session?.user) {
    throw new ChatSDKError("unauthorized:chat");
  }

  const [message] = await getMessageById({ id });

  if (!message) {
    throw new ChatSDKError("not_found:chat");
  }

  const chat = await getChatById({ id: message.chatId });

  if (!chat) {
    throw new ChatSDKError("not_found:chat");
  }

  if (chat.userId !== session.user.id) {
    throw new ChatSDKError("forbidden:chat");
  }

  await deleteMessagesByChatIdAfterTimestamp({
    chatId: message.chatId,
    timestamp: message.createdAt,
  });
}

export async function updateChatVisibility({
  chatId,
  visibility,
}: {
  chatId: string;
  visibility: VisibilityType;
}) {
  const session = await auth();

  if (!session?.user) {
    throw new ChatSDKError("unauthorized:chat");
  }

  const chat = await getChatById({ id: chatId });

  if (!chat) {
    throw new ChatSDKError("not_found:chat");
  }

  if (chat.userId !== session.user.id) {
    throw new ChatSDKError("forbidden:chat");
  }

  await updateChatVisiblityById({ chatId, visibility });
}
