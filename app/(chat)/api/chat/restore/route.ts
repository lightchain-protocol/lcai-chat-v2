import type { NextRequest } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { saveChat, saveMessages } from "@/lib/db/queries";
import { ChatSDKError } from "@/lib/errors";
import { validateImportedChat } from "@/lib/utils/export-helpers";
import { decryptData, retrieveFromIPFS } from "@/lib/utils/ipfs-helpers";

export async function POST(request: NextRequest) {
  const session = await auth();

  if (!session?.user) {
    return new ChatSDKError("unauthorized:chat").toResponse();
  }

  try {
    const { cid } = await request.json();

    if (!cid || typeof cid !== "string") {
      return new ChatSDKError(
        "bad_request:api",
        "CID is required"
      ).toResponse();
    }

    // Retrieve data from IPFS
    const ipfsData = await retrieveFromIPFS(cid);
    let jsonData: any;

    try {
      // Try to parse as encrypted format first
      const parsed = JSON.parse(ipfsData);
      if (parsed.encrypted && parsed.iv) {
        // Decrypt if encrypted
        if (!session.user.walletAddress) {
          return new ChatSDKError(
            "unauthorized:chat",
            "Wallet address required to restore encrypted chat"
          ).toResponse();
        }

        const decrypted = await decryptData(
          parsed.encrypted,
          parsed.iv,
          session.user.walletAddress
        );
        jsonData = JSON.parse(decrypted);
      } else {
        // Not encrypted, use directly
        jsonData = parsed;
      }
    } catch (_parseError) {
      // If parsing fails, try direct JSON parse
      jsonData = JSON.parse(ipfsData);
    }

    // Validate the imported data
    const validation = validateImportedChat(jsonData);
    if (!validation.valid) {
      return new ChatSDKError(
        "bad_request:api",
        validation.error || "Invalid chat data from IPFS"
      ).toResponse();
    }

    // Generate new IDs for the imported chat and messages
    const newChatId = crypto.randomUUID();
    const messageIdMap = new Map<string, string>();

    // Create new message IDs
    for (const message of jsonData.messages) {
      const newMessageId = crypto.randomUUID();
      messageIdMap.set(message.id, newMessageId);
    }

    // Save the chat with new ID and current user
    await saveChat({
      id: newChatId,
      userId: session.user.id,
      title: `${jsonData.chat.title} (Restored from IPFS)`,
      visibility: "private", // Always restore as private for security
    });

    // Prepare messages with new IDs
    const messagesWithNewIds = jsonData.messages.map((msg: any) => ({
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
        message: "Chat restored from IPFS successfully",
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error restoring chat from IPFS:", error);

    if (error instanceof ChatSDKError) {
      return error.toResponse();
    }

    return new ChatSDKError(
      "internal:server",
      error instanceof Error
        ? error.message
        : "Failed to restore chat from IPFS. Please check the CID."
    ).toResponse();
  }
}
