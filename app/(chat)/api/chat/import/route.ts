import type { NextRequest } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { saveChat, saveMessages } from "@/lib/db/queries";
import { ChatSDKError } from "@/lib/errors";
import { validateImportedChat } from "@/lib/utils/export-helpers";

export async function POST(request: NextRequest) {
  const session = await auth();

  if (!session?.user) {
    return new ChatSDKError("unauthorized:chat").toResponse();
  }

  try {
    const data = await request.json();

    // Validate the imported data
    const validation = validateImportedChat(data);
    if (!validation.valid) {
      return new ChatSDKError(
        "bad_request:api",
        validation.error || "Invalid chat data"
      ).toResponse();
    }

    // Generate new IDs for the imported chat and messages
    const newChatId = crypto.randomUUID();
    const messageIdMap = new Map<string, string>();

    // Create new message IDs
    for (const message of data.messages) {
      const newMessageId = crypto.randomUUID();
      messageIdMap.set(message.id, newMessageId);
    }

    // Save the chat with new ID and current user
    await saveChat({
      id: newChatId,
      userId: session.user.id,
      title: `${data.chat.title} (Imported)`,
      visibility: "private", // Always import as private for security
    });

    // Prepare messages with new IDs
    const messagesWithNewIds = data.messages.map((msg: any) => ({
      id: messageIdMap.get(msg.id),
      chatId: newChatId,
      role: msg.role,
      parts: msg.parts,
      attachments: msg.attachments || [],
      createdAt: new Date(msg.createdAt),
    }));

    // Save all messages
    await saveMessages({ messages: messagesWithNewIds });

    return Response.json(
      {
        success: true,
        chatId: newChatId,
        message: "Chat imported successfully",
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error importing chat:", error);

    if (error instanceof ChatSDKError) {
      return error.toResponse();
    }

    return new ChatSDKError(
      "internal:server",
      "Failed to import chat. Please check the file format."
    ).toResponse();
  }
}
