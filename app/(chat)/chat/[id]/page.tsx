import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/app/(auth)/auth";
import { Chat } from "@/components/chat";
import { DataStreamHandler } from "@/components/data-stream-handler";
import { DEFAULT_CHAT_MODEL } from "@/lib/ai/models";
import { $http } from "@/lib/http";
import type { ChatMessage } from "@/lib/types";
import { convertToUIMessages } from "@/lib/utils";

export default async function Page(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const { id } = params;

  const session = await auth();

  if (!session) {
    redirect("/api/auth/guest");
  }

  const chatResponse = await $http.get(`/api/chat/${id}`, {
    bearerToken: session.user?.token,
    cache: "no-store",
  });
  if (!chatResponse.ok) {
    redirect("/");
  }
  const chat = await chatResponse.json();

  if (!chat) {
    redirect("/");
  }

  if (chat.visibility === "private") {
    if (!session.user) {
      return redirect("/");
    }

    if (
      (session.user.walletAddress ?? "").toLowerCase() !==
      (chat.owner ?? "").toLowerCase()
    ) {
      return redirect("/");
    }
  }

  // Mid-flight tolerance: while a job is streaming, the messages endpoint can
  // transiently fail or return a half-written row (in-flight assistant
  // message). That must never 500 the page or bounce the user to "/" — render
  // with what we have; autoResume picks the live stream back up client-side.
  let uiMessages: ChatMessage[] = [];
  try {
    const messagesResponse = await $http.get(`/api/chat/${id}/messages`, {
      cache: "no-store",
      bearerToken: session.user?.token,
    });
    if (messagesResponse.ok) {
      const messages = await messagesResponse.json();
      if (Array.isArray(messages)) {
        uiMessages = convertToUIMessages(messages);
      }
    }
  } catch (error) {
    console.warn(`Messages fetch for chat ${id} failed; rendering empty`, error);
  }

  const cookieStore = await cookies();
  const chatModelFromCookie = cookieStore.get("chat-model");

  if (!chatModelFromCookie) {
    return (
      <>
        <Chat
          autoResume={true}
          id={chat.id}
          initialChatModel={DEFAULT_CHAT_MODEL}
          initialLastContext={chat.lastContext ?? undefined}
          initialMessages={uiMessages}
          initialSystemPrompt={chat.systemPrompt ?? null}
          initialVisibilityType={chat.visibility}
          isReadonly={session?.user?.walletAddress !== chat.owner}
        />
        <DataStreamHandler />
      </>
    );
  }

  return (
    <>
      <Chat
        autoResume={true}
        id={chat.id}
        initialChatModel={chatModelFromCookie.value}
        initialLastContext={chat.lastContext ?? undefined}
        initialMessages={uiMessages}
        initialSystemPrompt={chat.systemPrompt ?? null}
        initialVisibilityType={chat.visibility}
        isReadonly={session?.user?.walletAddress !== chat.owner}
      />
      <DataStreamHandler />
    </>
  );
}
