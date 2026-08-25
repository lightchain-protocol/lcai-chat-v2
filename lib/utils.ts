import type {
  AssistantModelMessage,
  ToolModelMessage,
  UIMessage,
  UIMessagePart,
} from 'ai';
import { type ClassValue, clsx } from 'clsx';
import { formatISO } from 'date-fns';
import { twMerge } from 'tailwind-merge';
import type { DBMessage } from '@/lib/db/schema';
import { ChatSDKError, type ErrorCode } from './errors';
import type { ChatMessage, ChatTools, CustomUIDataTypes } from './types';
import { $http } from './http';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const fetcher = async (url: string) => {
  const response = await $http.get(url);

  if (!response.ok) {
    const { code, cause } = await response.json();
    throw new ChatSDKError(code as ErrorCode, cause);
  }

  return response.json();
};

export async function fetchWithErrorHandlers(
  input: RequestInfo | URL,
  init?: RequestInit,
) {
  try {
    const response = await $http.request(input, init);

    if (!response.ok) {
      const { code, cause } = await response.json();
      throw new ChatSDKError(code as ErrorCode, cause);
    }

    return response;
  } catch (error: unknown) {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      throw new ChatSDKError('offline:chat');
    }

    throw error;
  }
}

export function getLocalStorage(key: string) {
  if (typeof window !== 'undefined') {
    return JSON.parse(localStorage.getItem(key) || '[]');
  }
  return [];
}

export function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

type ResponseMessageWithoutId = ToolModelMessage | AssistantModelMessage;
type ResponseMessage = ResponseMessageWithoutId & { id: string };  

export function getMostRecentUserMessage(messages: UIMessage[]) {
  const userMessages = messages.filter((message) => message.role === 'user');
  return userMessages.at(-1);
}

export function getTrailingMessageId({
  messages,
}: {
  messages: ResponseMessage[];
}): string | null {
  const trailingMessage = messages.at(-1);

  if (!trailingMessage) { return null; }

  return trailingMessage.id;
}

export function sanitizeText(text: string) {
  return text.replace('<has_function_call>', '');
}

/**
 * Wire shape returned by GET /api/chat/:id/messages.
 * Extends DBMessage with protocol fields stored in the consumer-api schema
 * but absent from the local Drizzle type.
 */
type APIMessage = DBMessage & {
  jobId?: number | null;
  protocolMeta?: Record<string, unknown> | null;
};

export function convertToUIMessages(messages: APIMessage[]): ChatMessage[] {
  // Per-row tolerance: a half-written in-flight row (null createdAt, missing
  // parts) must not take down the whole /chat/[id] render — skip it; the live
  // stream or the next reload replaces it.
  return messages.flatMap((message) => {
    try {
      const createdAt = message.createdAt
        ? formatISO(message.createdAt)
        : formatISO(new Date(0));
      return [
        {
          id: message.id,
          role: message.role as 'user' | 'assistant' | 'system',
          parts: (Array.isArray(message.parts)
            ? message.parts
            : []) as UIMessagePart<CustomUIDataTypes, ChatTools>[],
          metadata: {
            createdAt,
            ...(message.jobId != null ? { jobId: message.jobId } : {}),
            ...(message.protocolMeta
              ? { protocolMeta: message.protocolMeta }
              : {}),
          },
        },
      ];
    } catch (error) {
      console.warn('Skipping malformed message row', message?.id, error);
      return [];
    }
  });
}

export function getTextFromMessage(message: ChatMessage): string {
  return message.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('');
} 

export function formatDate(timestamp: number | undefined) {
  if (!timestamp) return "N/A";
  const date = new Date(timestamp * 1000);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

export function formatNumber(number?: string | number) {
  if (!number) return "0";
  return Number(number).toLocaleString();
}

export function compactNumber(number?: string | number) {
  if (!number) return "0";
  return Number(number).toLocaleString("en-US", {
    maximumFractionDigits: 2,
    notation: "compact",
  });
}