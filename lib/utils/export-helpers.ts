import type { Chat, DBMessage } from "@/lib/db/schema";

/**
 * Export chat to JSON format
 */
export function exportToJSON(chat: Chat, messages: DBMessage[]): string {
  return JSON.stringify(
    {
      version: "1.0",
      exportedAt: new Date().toISOString(),
      chat: {
        id: chat.id,
        title: chat.title,
        createdAt: chat.createdAt,
        visibility: chat.visibility,
        owner: chat.owner,
      },
      messages: messages.map((msg) => ({
        id: msg.id,
        role: msg.role,
        parts: msg.parts,
        attachments: msg.attachments,
        createdAt: msg.createdAt,
      })),
    },
    null,
    2
  );
}

/**
 * Download file utility
 */
export function downloadFile(
  content: string,
  filename: string,
  mimeType: string
) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Validate imported chat data
 */
export function validateImportedChat(data: any): {
  valid: boolean;
  error?: string;
} {
  if (!data || typeof data !== "object") {
    return { valid: false, error: "Invalid JSON format" };
  }

  if (!data.version || typeof data.version !== "string") {
    return { valid: false, error: "Missing or invalid version field" };
  }

  if (!data.chat || typeof data.chat !== "object") {
    return { valid: false, error: "Missing or invalid chat data" };
  }

  if (!data.chat.title || typeof data.chat.title !== "string") {
    return { valid: false, error: "Missing or invalid chat title" };
  }

  if (!Array.isArray(data.messages)) {
    return { valid: false, error: "Messages must be an array" };
  }

  // Validate each message
  for (const message of data.messages) {
    if (!message.role || typeof message.role !== "string") {
      return { valid: false, error: "Invalid message role" };
    }

    if (!Array.isArray(message.parts)) {
      return { valid: false, error: "Message parts must be an array" };
    }
  }

  return { valid: true };
}
