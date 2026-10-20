import { ModerationAction, Prisma } from "@prisma/client";
import { prisma } from "@/infrastructure/prisma";
import { NotFoundError } from "@/shared/errors/AppError";
import { buildPaginationMeta } from "@/shared/http/apiResponse";
import { toPrismaPagination } from "@/shared/http/pagination";
import { emitToUsers } from "@/realtime/socket";
import {
  attachmentKeysInConversation,
  attachmentKeysOf,
  removeUnreferencedAttachments,
} from "@/shared/chat/attachments";
import {
  conversationInclude,
  ConversationWithRelations,
  messageInclude,
  previewOf,
  serializeMessage,
  serializeParticipant,
} from "@/shared/chat/helpers";
import {
  CONVERSATION_PAGE_ORDER,
  MESSAGE_PAGE_ORDER,
  conversationPageWhere,
  nextConversationCursor,
  olderMessagesWhere,
} from "@/shared/chat/pagination";
import type {
  AdminConversationListQuery,
  AdminMessageListQuery,
} from "./messages.validators";

const moderationInclude = {
  ...conversationInclude,
  _count: { select: { messages: true } },
} satisfies Prisma.ConversationInclude;

type ModerationConversation = ConversationWithRelations & {
  _count: { messages: number };
};

const serializeForModeration = (conversation: ModerationConversation) => {
  const participants = conversation.participants.map(serializeParticipant);
  const lastMessage = conversation.messages[0];
  return {
    id: conversation.id,
    isGroup: conversation.isGroup,
    name: conversation.isGroup
      ? (conversation.name ?? "Group")
      : participants.map((p) => p.name).join(" & ") || "Empty conversation",
    participants,
    preview: previewOf(lastMessage),
    time: lastMessage?.createdAt ?? conversation.updatedAt,
    messageCount: conversation._count.messages,
    createdAt: conversation.createdAt,
  };
};

const participantIdsOf = async (conversationId: string) =>
  (
    await prisma.conversationParticipant.findMany({
      where: { conversationId },
      select: { userId: true },
    })
  ).map((row) => row.userId);

export const adminMessagesService = {
  async listConversations(query: AdminConversationListQuery) {
    const terms = (query.search ?? "").split(/\s+/).filter(Boolean).slice(0, 3);
    const where: Prisma.ConversationWhereInput = {
      ...(query.type ? { isGroup: query.type === "group" } : {}),
      ...(terms.length
        ? {
            OR: [
              { name: { contains: query.search, mode: "insensitive" } },
              {
                participants: {
                  some: {
                    user: {
                      AND: terms.map((term) => ({
                        OR: [
                          { email: { contains: term, mode: "insensitive" as const } },
                          { profile: { firstName: { contains: term, mode: "insensitive" as const } } },
                          { profile: { lastName: { contains: term, mode: "insensitive" as const } } },
                        ],
                      })),
                    },
                  },
                },
              },
            ],
          }
        : {}),
    };
    const { skip } = toPrismaPagination(query.page, query.pageSize);

    const [found, total] = await prisma.$transaction([
      prisma.conversation.findMany({
        where: conversationPageWhere(where, query.cursor),
        include: moderationInclude,
        orderBy: CONVERSATION_PAGE_ORDER,
        skip: query.cursor ? 0 : skip,
        take: query.pageSize + 1,
      }),
      prisma.conversation.count({ where }),
    ]);
    const hasMore = found.length > query.pageSize;
    const rows = found.slice(0, query.pageSize);

    return {
      data: rows.map(serializeForModeration),
      meta: {
        ...buildPaginationMeta(query.page, query.pageSize, total),
        hasMore,
        nextCursor: nextConversationCursor(rows, hasMore),
      },
    };
  },

  async getConversation(conversationId: string) {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: moderationInclude,
    });
    if (!conversation) throw new NotFoundError("Conversation not found");
    return serializeForModeration(conversation);
  },

  async getMessages(
    adminId: string,
    conversationId: string,
    query: AdminMessageListQuery,
  ) {
    const exists = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundError("Conversation not found");

    const rows = await prisma.message.findMany({
      where: { conversationId, ...olderMessagesWhere(query) },
      include: messageInclude,
      orderBy: MESSAGE_PAGE_ORDER,
      take: query.pageSize + 1,
    });
    const hasMore = rows.length > query.pageSize;

    return {
      data: rows
        .slice(0, query.pageSize)
        .reverse()
        .map((message) => serializeMessage(message, adminId)),
      meta: { pageSize: query.pageSize, hasMore },
    };
  },

  /** Removes one message and records who removed whose content (never the text itself). */
  async deleteMessage(conversationId: string, messageId: string, actorId: string) {
    const message = await prisma.message.findFirst({
      where: { id: messageId, conversationId },
      select: { id: true, senderId: true, attachments: true },
    });
    if (!message) throw new NotFoundError("Message not found");
    await prisma.$transaction([
      prisma.message.delete({ where: { id: messageId } }),
      prisma.moderationLog.create({
        data: {
          actorId,
          targetUserId: message.senderId,
          action: ModerationAction.REMOVE_CONTENT,
          note: `Removed chat message ${messageId} in conversation ${conversationId}`,
        },
      }),
    ]);
    await removeUnreferencedAttachments(attachmentKeysOf(message.attachments));

    emitToUsers(await participantIdsOf(conversationId), "message:deleted", {
      conversationId,
      messageId,
    });
    return { conversationId, messageId, message: "Message deleted" };
  },

  /** Deletes a whole conversation; the log keeps ids and counts only. */
  async deleteConversation(conversationId: string, actorId: string) {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { id: true, _count: { select: { messages: true } } },
    });
    if (!conversation) throw new NotFoundError("Conversation not found");
    const participants = await participantIdsOf(conversationId);
    const keys = await attachmentKeysInConversation(conversationId);
    await prisma.$transaction([
      prisma.conversation.deleteMany({ where: { id: conversationId } }),
      prisma.moderationLog.create({
        data: {
          actorId,
          targetUserId: null,
          action: ModerationAction.REMOVE_CONTENT,
          note: `Deleted conversation ${conversationId} (${conversation._count.messages} messages, ${participants.length} participants)`,
        },
      }),
    ]);
    await removeUnreferencedAttachments(keys);

    emitToUsers(participants, "conversation:removed", { conversationId });
    return { conversationId, message: "Conversation deleted" };
  },
};
