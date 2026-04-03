import type { NextRequest } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { getChatById, getMessagesByChatId } from "@/lib/db/queries";
import { ChatSDKError } from "@/lib/errors";
import { exportToJSON } from "@/lib/utils/export-helpers";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();

  if (!session?.user) {
    return new ChatSDKError("unauthorized:chat").toResponse();
  }

  const { id } = await params;

  // Get chat and verify ownership
  const chat = await getChatById({ id });

  if (!chat) {
    return new ChatSDKError(
      "not_found:database",
      "Chat not found"
    ).toResponse();
  }

  // Verify user owns this chat
  if (chat.owner !== session.user.id) {
    return new ChatSDKError(
      "unauthorized:chat",
      "You don't have permission to export this chat"
    ).toResponse();
  }

  // Get all messages for this chat
  const messages = await getMessagesByChatId({ id });

  // Export to JSON
  const jsonContent = exportToJSON(chat, messages);

  // Return JSON file
  return new Response(jsonContent, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="chat-${chat.title.replace(/[^a-z0-9]/gi, "_").toLowerCase()}-${id.slice(0, 8)}.json"`,
    },
  });
}
