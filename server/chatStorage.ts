import {
  conversations,
  messages,
  type Conversation,
  type InsertConversation,
  type Message,
  type InsertMessage,
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, asc, and, isNull } from "drizzle-orm";

export const chatStorage = {
  async createConversation(data: InsertConversation): Promise<Conversation> {
    const [created] = await db.insert(conversations).values(data as any).returning();
    return created;
  },

  async getConversation(id: string): Promise<Conversation | null> {
    const [conv] = await db.select().from(conversations).where(eq(conversations.id, id));
    return conv || null;
  },

  async getConversationsForUser(userId?: string, projectId?: string): Promise<Conversation[]> {
    if (userId && projectId) {
      return db.select().from(conversations)
        .where(and(eq(conversations.userId, userId), eq(conversations.projectId, projectId)))
        .orderBy(desc(conversations.updatedAt));
    }
    if (userId) {
      return db.select().from(conversations).where(eq(conversations.userId, userId)).orderBy(desc(conversations.updatedAt));
    }
    return db.select().from(conversations).orderBy(desc(conversations.updatedAt));
  },

  async getConversationsForProject(projectId: string, userId?: string): Promise<Conversation[]> {
    if (userId) {
      return db.select().from(conversations)
        .where(and(eq(conversations.projectId, projectId), eq(conversations.userId, userId)))
        .orderBy(desc(conversations.updatedAt));
    }
    return db.select().from(conversations)
      .where(eq(conversations.projectId, projectId))
      .orderBy(desc(conversations.updatedAt));
  },

  async getStandaloneConversations(userId: string): Promise<Conversation[]> {
    return db.select().from(conversations)
      .where(and(eq(conversations.userId, userId), isNull(conversations.projectId)))
      .orderBy(desc(conversations.updatedAt));
  },

  async updateConversation(
    id: string,
    data: Partial<
      Pick<
        Conversation,
        "title" | "model" | "writingModel" | "selectedSourceIds" | "citationStyle" | "tone" | "humanize" | "noEnDashes"
      >
    >
  ): Promise<Conversation> {
    const [updated] = await db
      .update(conversations)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(conversations.id, id))
      .returning();
    return updated;
  },

  async updateSelectedSources(id: string, selectedSourceIds: string[]): Promise<Conversation> {
    const [updated] = await db
      .update(conversations)
      .set({ selectedSourceIds, updatedAt: new Date() })
      .where(eq(conversations.id, id))
      .returning();
    return updated;
  },

  async deleteConversation(id: string): Promise<void> {
    await db.delete(conversations).where(eq(conversations.id, id));
  },

  async getMessagesForConversation(conversationId: string): Promise<Message[]> {
    return db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(asc(messages.createdAt));
  },

  async createMessage(data: InsertMessage): Promise<Message> {
    const [created] = await db.insert(messages).values(data as any).returning();
    // Touch the conversation's updatedAt
    await db
      .update(conversations)
      .set({ updatedAt: new Date() })
      .where(eq(conversations.id, data.conversationId));
    return created;
  },
};

export async function updateConversationClipboard(id: string, clipboard: string | null): Promise<void> {
  await db
    .update(conversations)
    .set({
      evidenceClipboard: clipboard,
      updatedAt: new Date(),
    })
    .where(eq(conversations.id, id));
}

export async function getConversationClipboard(id: string): Promise<string | null> {
  const [conversation] = await db
    .select({ evidenceClipboard: conversations.evidenceClipboard })
    .from(conversations)
    .where(eq(conversations.id, id));

  return conversation?.evidenceClipboard ?? null;
}

export async function updateConversationCompaction(
  id: string,
  data: { compactionSummary: string | null; compactedAtTurn: number },
): Promise<void> {
  await db
    .update(conversations)
    .set({
      compactionSummary: data.compactionSummary,
      compactedAtTurn: data.compactedAtTurn,
      updatedAt: new Date(),
    })
    .where(eq(conversations.id, id));
}

export async function getConversationCompaction(
  id: string,
): Promise<{ compactionSummary: string | null; compactedAtTurn: number }> {
  const [conversation] = await db
    .select({
      compactionSummary: conversations.compactionSummary,
      compactedAtTurn: conversations.compactedAtTurn,
    })
    .from(conversations)
    .where(eq(conversations.id, id));

  return {
    compactionSummary: conversation?.compactionSummary ?? null,
    compactedAtTurn: conversation?.compactedAtTurn ?? 0,
  };
}
