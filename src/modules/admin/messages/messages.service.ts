import { Prisma } from "@prisma/client";
import { prisma } from "@/infrastructure/prisma";
import { NotFoundError } from "@/shared/errors/AppError";
import { buildPaginationMeta } from "@/shared/http/apiResponse";
import { toPrismaPagination } from "@/shared/http/pagination";
import { emitToUsers } from "@/realtime/socket";
import {
  conversationInclude,
  ConversationWithRelations,
  messageInclude,
  previewOf,
  serializeMessage,
  serializeParticipant,
} from "@/modules/user/messages/messages.helpers";
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
    const { skip, take } = toPrismaPagination(query.page, query.pageSize);

    const [rows, total] = await prisma.$transaction([
      prisma.conversation.findMany({
        where,
        include: moderationInclude,
        orderBy: { updatedAt: "desc" },
        skip,
        take,
      }),
      prisma.conversation.count({ where }),
    ]);

    return {
      data: rows.map(serializeForModeration),
      meta: buildPaginationMeta(query.page, query.pageSize, total),
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
      where: {
        conversationId,
        ...(query.before ? { createdAt: { lt: query.before } } : {}),
      },
      include: messageInclude,
      orderBy: { createdAt: "desc" },
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

  async deleteMessage(conversationId: string, messageId: string) {
    const message = await prisma.message.findFirst({
      where: { id: messageId, conversationId },
      select: { id: true },
    });
    if (!message) throw new NotFoundError("Message not found");
    await prisma.message.delete({ where: { id: messageId } });

    emitToUsers(await participantIdsOf(conversationId), "message:deleted", {
      conversationId,
      messageId,
    });
    return { conversationId, messageId, message: "Message deleted" };
  },

  async deleteConversation(conversationId: string) {
    const participants = await participantIdsOf(conversationId);
    const deleted = await prisma.conversation.deleteMany({
      where: { id: conversationId },
    });
    if (deleted.count === 0) throw new NotFoundError("Conversation not found");

    emitToUsers(participants, "conversation:removed", { conversationId });
    return { conversationId, message: "Conversation deleted" };
  },
};
