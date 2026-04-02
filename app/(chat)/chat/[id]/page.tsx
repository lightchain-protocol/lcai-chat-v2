import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { auth } from "@/app/(auth)/auth";
import { Chat } from "@/components/chat";
import { DataStreamHandler } from "@/components/data-stream-handler";
import { DEFAULT_CHAT_MODEL } from "@/lib/ai/models";
import { convertToUIMessages } from "@/lib/utils";

const TRAILING_SLASHES_REGEX = /\/+$/;

export default async function Page(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const { id } = params;

  const session = await auth();

  if (!session) {
    redirect("/api/auth/guest");
  }

  const consumerApiBaseUrl = (
    process.env.CONSUMER_API_URL ?? process.env.NEXT_PUBLIC_CONSUMER_API_URL
  )?.replace(TRAILING_SLASHES_REGEX, "");
  if (!consumerApiBaseUrl) {
    notFound();
  }

  const chatResponse = await fetch(`${consumerApiBaseUrl}/api/chat/${id}`, {
    cache: "no-store",
  });
  if (!chatResponse.ok) {
    notFound();
  }
  const chat = await chatResponse.json();

  if (!chat) {
    notFound();
  }

  console.log(chat, session.user.walletAddress, chat.owner);

  if (chat.visibility === "private") {
    if (!session.user) {
      return notFound();
    }

    if (
      (session.user.walletAddress ?? "").toLowerCase() !==
      (chat.owner ?? "").toLowerCase()
    ) {
      return notFound();
    }
  }

  const messagesResponse = await fetch(
    `${consumerApiBaseUrl}/api/chat/${id}/messages`,
    {
      cache: "no-store",
    }
  );
  if (!messagesResponse.ok) {
    notFound();
  }
  const messagesFromDb = await messagesResponse.json();

  const uiMessages = convertToUIMessages(messagesFromDb);

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
