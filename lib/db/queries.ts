import "server-only";

import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  lt,
  type SQL,
  sql,
} from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { VisibilityType } from "@/components/visibility-selector";
import { ChatSDKError } from "../errors";
import type { AppUsage } from "../usage";
import {
  type Chat,
  chat,
  type DBMessage,
  message,
  stream,
  type User,
  user,
  vote,
} from "./schema";

// Optionally, if not using email/pass login, you can
// use the Drizzle adapter for Auth.js / NextAuth
// https://authjs.dev/reference/adapter/drizzle

// biome-ignore lint: Forbidden non-null assertion.
const client = postgres(process.env.POSTGRES_URL!);
export const db = drizzle(client);

export async function getUserByWallet(walletAddress: string): Promise<User[]> {
  try {
    return await db
      .select()
      .from(user)
      .where(eq(user.wallet_address, walletAddress));
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to get user by wallet address"
    );
  }
}

export async function createUser(walletAddress: string, username?: string) {
  try {
    return await db
      .insert(user)
      .values({
        wallet_address: walletAddress,
        username: username || walletAddress,
      })
      .returning({
        id: user.id,
        wallet_address: user.wallet_address,
        username: user.username,
      });
  } catch (_error) {
    throw new ChatSDKError("bad_request:database", "Failed to create user");
  }
}

export async function saveChat({
  id,
  userId,
  title,
  visibility,
  systemPrompt,
}: {
  id: string;
  userId: string;
  title: string;
  visibility: VisibilityType;
  systemPrompt?: string | null;
}) {
  try {
    return await db.insert(chat).values({
      id,
      createdAt: new Date(),
      owner: userId,
      title,
      visibility,
      systemPrompt: systemPrompt || null,
    });
  } catch (_error) {
    throw new ChatSDKError("bad_request:database", "Failed to save chat");
  }
}

export async function updateChatTitleById({
  id,
  title,
}: {
  id: string;
  title: string;
}) {
  try {
    return await db.update(chat).set({ title }).where(eq(chat.id, id));
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to update chat title by id"
    );
  }
}

export async function deleteChatById({ id }: { id: string }) {
  try {
    await db.delete(vote).where(eq(vote.chatId, id));
    await db.delete(message).where(eq(message.chatId, id));
    await db.delete(stream).where(eq(stream.chatId, id));

    const [chatsDeleted] = await db
      .delete(chat)
      .where(eq(chat.id, id))
      .returning();
    return chatsDeleted;
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to delete chat by id"
    );
  }
}

export async function deleteAllChatsByUserId({ userId }: { userId: string }) {
  try {
    const userChats = await db
      .select({ id: chat.id })
      .from(chat)
      .where(eq(chat.owner, userId));

    if (userChats.length === 0) {
      return { deletedCount: 0 };
    }

    const chatIds = userChats.map((c) => c.id);

    await db.delete(vote).where(inArray(vote.chatId, chatIds));
    await db.delete(message).where(inArray(message.chatId, chatIds));
    await db.delete(stream).where(inArray(stream.chatId, chatIds));

    const deletedChats = await db
      .delete(chat)
      .where(eq(chat.owner, userId))
      .returning();

    return { deletedCount: deletedChats.length };
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to delete all chats by user id"
    );
  }
}

export async function getChatsByUserId({
  id,
  limit,
  startingAfter,
  endingBefore,
}: {
  id: string;
  limit: number;
  startingAfter: string | null;
  endingBefore: string | null;
}) {
  try {
    const extendedLimit = limit + 1;

    const query = (whereCondition?: SQL<any>) =>
      db
        .select()
        .from(chat)
        .where(
          whereCondition
            ? and(whereCondition, eq(chat.owner, id))
            : eq(chat.owner, id)
        )
        .orderBy(desc(chat.createdAt))
        .limit(extendedLimit);

    let filteredChats: Chat[] = [];

    if (startingAfter) {
      const [selectedChat] = await db
        .select()
        .from(chat)
        .where(eq(chat.id, startingAfter))
        .limit(1);

      if (!selectedChat) {
        throw new ChatSDKError(
          "not_found:database",
          `Chat with id ${startingAfter} not found`
        );
      }

      filteredChats = await query(gt(chat.createdAt, selectedChat.createdAt));
    } else if (endingBefore) {
      const [selectedChat] = await db
        .select()
        .from(chat)
        .where(eq(chat.id, endingBefore))
        .limit(1);

      if (!selectedChat) {
        throw new ChatSDKError(
          "not_found:database",
          `Chat with id ${endingBefore} not found`
        );
      }

      filteredChats = await query(lt(chat.createdAt, selectedChat.createdAt));
    } else {
      filteredChats = await query();
    }

    const hasMore = filteredChats.length > limit;

    return {
      chats: hasMore ? filteredChats.slice(0, limit) : filteredChats,
      hasMore,
    };
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to get chats by user id"
    );
  }
}

export async function getChatById({ id }: { id: string }) {
  try {
    const [selectedChat] = await db.select().from(chat).where(eq(chat.id, id));
    if (!selectedChat) {
      return null;
    }

    return selectedChat;
  } catch (_error) {
    throw new ChatSDKError("bad_request:database", "Failed to get chat by id");
  }
}

export async function saveMessages({ messages }: { messages: DBMessage[] }) {
  try {
    return await db.insert(message).values(messages);
  } catch (_error) {
    throw new ChatSDKError("bad_request:database", "Failed to save messages");
  }
}

export async function getMessagesByChatId({ id }: { id: string }) {
  try {
    return await db
      .select()
      .from(message)
      .where(eq(message.chatId, id))
      .orderBy(asc(message.createdAt));
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to get messages by chat id"
    );
  }
}

export async function voteMessage({
  chatId,
  messageId,
  type,
}: {
  chatId: string;
  messageId: string;
  type: "up" | "down";
}) {
  try {
    const [existingVote] = await db
      .select()
      .from(vote)
      .where(and(eq(vote.messageId, messageId)));

    if (existingVote) {
      return await db
        .update(vote)
        .set({ isUpvoted: type === "up" })
        .where(and(eq(vote.messageId, messageId), eq(vote.chatId, chatId)));
    }
    return await db.insert(vote).values({
      chatId,
      messageId,
      isUpvoted: type === "up",
    });
  } catch (_error) {
    throw new ChatSDKError("bad_request:database", "Failed to vote message");
  }
}

export async function getVotesByChatId({ id }: { id: string }) {
  try {
    return await db.select().from(vote).where(eq(vote.chatId, id));
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to get votes by chat id"
    );
  }
}

export async function getMessageById({ id }: { id: string }) {
  try {
    return await db.select().from(message).where(eq(message.id, id));
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to get message by id"
    );
  }
}

export async function deleteMessagesByChatIdAfterTimestamp({
  chatId,
  timestamp,
}: {
  chatId: string;
  timestamp: Date;
}) {
  try {
    const messagesToDelete = await db
      .select({ id: message.id })
      .from(message)
      .where(
        and(eq(message.chatId, chatId), gte(message.createdAt, timestamp))
      );

    const messageIds = messagesToDelete.map(
      (currentMessage) => currentMessage.id
    );

    if (messageIds.length > 0) {
      await db
        .delete(vote)
        .where(
          and(eq(vote.chatId, chatId), inArray(vote.messageId, messageIds))
        );

      return await db
        .delete(message)
        .where(
          and(eq(message.chatId, chatId), inArray(message.id, messageIds))
        );
    }
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to delete messages by chat id after timestamp"
    );
  }
}

export async function updateChatLastContextById({
  chatId,
  context,
}: {
  chatId: string;
  // Store merged server-enriched usage object
  context: AppUsage;
}) {
  try {
    return await db
      .update(chat)
      .set({ lastContext: context })
      .where(eq(chat.id, chatId));
  } catch (error) {
    console.warn("Failed to update lastContext for chat", chatId, error);
    return;
  }
}

export async function updateChatSystemPromptById({
  chatId,
  systemPrompt,
}: {
  chatId: string;
  systemPrompt: string | null;
}) {
  try {
    return await db
      .update(chat)
      .set({ systemPrompt })
      .where(eq(chat.id, chatId));
  } catch (error) {
    console.warn("Failed to update systemPrompt for chat", chatId, error);
    return;
  }
}

export async function getMessageCountByUserId({
  id,
  differenceInHours,
}: {
  id: string;
  differenceInHours: number;
}) {
  try {
    const twentyFourHoursAgo = new Date(
      Date.now() - differenceInHours * 60 * 60 * 1000
    );

    const [stats] = await db
      .select({ count: count(message.id) })
      .from(message)
      .innerJoin(chat, eq(message.chatId, chat.id))
      .where(
        and(
            eq(chat.owner, id),
          gte(message.createdAt, twentyFourHoursAgo),
          eq(message.role, "user")
        )
      )
      .execute();

    return stats?.count ?? 0;
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to get message count by user id"
    );
  }
}

export async function createStreamId({
  streamId,
  chatId,
}: {
  streamId: string;
  chatId: string;
}) {
  try {
    await db
      .insert(stream)
      .values({ id: streamId, chatId, createdAt: new Date() });
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to create stream id"
    );
  }
}

export async function getStreamIdsByChatId({ chatId }: { chatId: string }) {
  try {
    const streamIds = await db
      .select({ id: stream.id })
      .from(stream)
      .where(eq(stream.chatId, chatId))
      .orderBy(asc(stream.createdAt))
      .execute();

    return streamIds.map(({ id }) => id);
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to get stream ids by chat id"
    );
  }
}

/**
 * Update chat with IPFS backup information
 */
export async function updateChatBackup({
  chatId,
  ipfsCid,
  encrypted,
}: {
  chatId: string;
  ipfsCid: string;
  encrypted: boolean;
}) {
  try {
    return await db
      .update(chat)
      .set({
        ipfsCid,
        backedUpAt: new Date(),
        backupEncrypted: encrypted,
      })
      .where(eq(chat.id, chatId));
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to update chat backup"
    );
  }
}

/**
 * Get chat backup status
 */
export async function getChatBackupStatus({ id }: { id: string }) {
  try {
    const [result] = await db
      .select({
        ipfsCid: chat.ipfsCid,
        backedUpAt: chat.backedUpAt,
        backupEncrypted: chat.backupEncrypted,
      })
      .from(chat)
      .where(eq(chat.id, id))
      .limit(1);

    return result || null;
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to get backup status"
    );
  }
}

export type SearchResult = {
  messageId: string;
  chatId: string;
  chatTitle: string;
  messageRole: string;
  messageParts: any;
  messageCreatedAt: Date;
  rank: number;
  highlight: string;
};

/**
 * Search messages using PostgreSQL full-text search
 */
export async function searchMessages({
  userId,
  query,
  limit = 20,
}: {
  userId: string;
  query: string;
  limit?: number;
}): Promise<SearchResult[]> {
  try {
    if (!query || query.trim().length === 0) {
      return [];
    }

    // Sanitize query for tsquery - replace special chars and add prefix matching
    const sanitizedQuery = query
      .trim()
      // biome-ignore lint/performance/useTopLevelRegex: test
      .split(/\s+/)
      .filter((word) => word.length > 0)
      .map((word) => `${word.replace(/[^a-zA-Z0-9]/g, "")}:*`)
      .join(" & ");

    if (!sanitizedQuery) {
      return [];
    }

    // Perform full-text search with ranking and highlighting
    const results = await db
      .select({
        messageId: message.id,
        chatId: chat.id,
        chatTitle: chat.title,
        messageRole: message.role,
        messageParts: message.parts,
        messageCreatedAt: message.createdAt,
        rank: sql<number>`ts_rank("Message"."search_vector", to_tsquery('english', ${sanitizedQuery}))`,
        highlight: sql<string>`ts_headline('english',
          (
            SELECT string_agg(part->>'text', ' ')
            FROM json_array_elements("Message"."parts"::json) AS part
            WHERE part->>'type' = 'text'
          ),
          to_tsquery('english', ${sanitizedQuery}),
          'MaxWords=20, MinWords=10, ShortWord=3, HighlightAll=FALSE, MaxFragments=1'
        )`,
      })
      .from(message)
      .innerJoin(chat, eq(message.chatId, chat.id))
      .where(
        and(
          eq(chat.owner, userId),
          sql`"Message"."search_vector" @@ to_tsquery('english', ${sanitizedQuery})`
        )
      )
      .orderBy(
        desc(
          sql`ts_rank("Message"."search_vector", to_tsquery('english', ${sanitizedQuery}))`
        )
      )
      .limit(limit);

    return results;
  } catch (_error) {
    console.error("Search error:", _error);
    throw new ChatSDKError("bad_request:database", "Failed to search messages");
  }
}
