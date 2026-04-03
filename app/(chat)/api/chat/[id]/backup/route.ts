import type { NextRequest } from "next/server";
import { auth } from "@/app/(auth)/auth";
import {
  getChatBackupStatus,
  getChatById,
  getMessagesByChatId,
  updateChatBackup,
} from "@/lib/db/queries";
import { ChatSDKError } from "@/lib/errors";
import { exportToJSON } from "@/lib/utils/export-helpers";
import { encryptData, uploadToIPFS } from "@/lib/utils/ipfs-helpers";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();

  if (!session?.user) {
    return new ChatSDKError("unauthorized:chat").toResponse();
  }

  const { id } = await params;

  try {
    // Get chat and verify ownership
    const chat = await getChatById({ id });

    if (!chat) {
      return new ChatSDKError(
        "not_found:database",
        "Chat not found"
      ).toResponse();
    }

    if (chat.owner !== session.user.id) {
      return new ChatSDKError(
        "unauthorized:chat",
        "You don't have permission to backup this chat"
      ).toResponse();
    }

    // Get all messages for this chat
    const messages = await getMessagesByChatId({ id });

    // Export to JSON
    let jsonContent = exportToJSON(chat, messages);
    let encrypted = false;

    // Encrypt if private chat and wallet address is available
    if (chat.visibility === "private" && session.user.walletAddress) {
      const encryptedResult = await encryptData(
        jsonContent,
        session.user.walletAddress
      );
      jsonContent = JSON.stringify({
        encrypted: encryptedResult.encrypted,
        iv: encryptedResult.iv,
      });
      encrypted = true;
    }

    // Upload to IPFS
    const filename = `chat-${chat.id}-${Date.now()}.json`;
    const cid = await uploadToIPFS(jsonContent, filename);

    // Update database with backup info
    await updateChatBackup({
      chatId: id,
      ipfsCid: cid,
      encrypted,
    });

    return Response.json(
      {
        success: true,
        cid,
        encrypted,
        message: "Chat backed up to IPFS successfully",
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error backing up chat to IPFS:", error);

    if (error instanceof ChatSDKError) {
      return error.toResponse();
    }

    return new ChatSDKError(
      "internal:server",
      error instanceof Error ? error.message : "Failed to backup chat to IPFS"
    ).toResponse();
  }
}

/**
 * Get backup status for a chat
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();

  if (!session?.user) {
    return new ChatSDKError("unauthorized:chat").toResponse();
  }

  const { id } = await params;

  try {
    const chat = await getChatById({ id });

    if (!chat) {
      return new ChatSDKError(
        "not_found:database",
        "Chat not found"
      ).toResponse();
    }

    if (chat.owner !== session.user.id) {
      return new ChatSDKError(
        "unauthorized:chat",
        "You don't have permission to view this chat's backup status"
      ).toResponse();
    }

    const backupStatus = await getChatBackupStatus({ id });

    return Response.json(
      {
        backedUp: !!backupStatus?.ipfsCid,
        cid: backupStatus?.ipfsCid || null,
        backedUpAt: backupStatus?.backedUpAt || null,
        encrypted: backupStatus?.backupEncrypted || false,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error getting backup status:", error);

    if (error instanceof ChatSDKError) {
      return error.toResponse();
    }

    return new ChatSDKError(
      "internal:server",
      "Failed to get backup status"
    ).toResponse();
  }
}
