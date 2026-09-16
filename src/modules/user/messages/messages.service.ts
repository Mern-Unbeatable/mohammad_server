import { Prisma } from "@prisma/client";
import { prisma } from "@/infrastructure/prisma";
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from "@/shared/errors/AppError";
import { buildPaginationMeta } from "@/shared/http/apiResponse";
import { toPrismaPagination } from "@/shared/http/pagination";

const participantInclude = {
  participants: { include: { user: { include: { profile: true } } } },
  messages: { orderBy: { createdAt: "desc" as const }, take: 1 },
} satisfies Prisma.ConversationInclude;

type ConversationPayload = Prisma.ConversationGetPayload<{
  include: typeof participantInclude;
}>;

const assertMembership = async (conversationId: string, userId: string) => {
  const participant = await prisma.conversationParticipant.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
  });
  if (!participant)
    throw new ForbiddenError("You are not a participant in this conversation");
  return participant;
};

const serializeConversation = (
  conversation: ConversationPayload,
  userId: string,
) => {
  const others = conversation.participants.filter((p) => p.userId !== userId);
  const primary = others[0]?.user;
  const lastMessage = conversation.messages[0];
  const self = conversation.participants.find((p) => p.userId === userId);

  const displayName = conversation.isGroup
    ? conversation.name
    : primary?.profile
      ? `${primary.profile.firstName} ${primary.profile.lastName}`.trim()
      : primary?.email;

  return {
    id: conversation.id,
    isGroup: conversation.isGroup,
    name: displayName,
    subtitle: conversation.isGroup
      ? `${conversation.participants.length} members`
      : primary?.profile
        ? [primary.profile.title, primary.profile.company]
            .filter(Boolean)
            .join(" · ")
        : null,
    initials: conversation.isGroup
      ? conversation.name?.slice(0, 2).toUpperCase()
      : primary?.profile?.initials,
    avatar: conversation.isGroup ? null : primary?.profile?.avatarUrl,
    preview: lastMessage?.body ?? null,
    time: lastMessage?.createdAt ?? conversation.updatedAt,
    participants: conversation.participants.map((p) => ({
      id: p.userId,
      name: p.user.profile
        ? `${p.user.profile.firstName} ${p.user.profile.lastName}`.trim()
        : p.user.email,
    })),
    lastReadAt: self?.lastReadAt ?? null,
  };
};

export const messagesService = {
  async listConversations(
    userId: string,
    query: { type?: string; search?: string },
  ) {
    const conversations = await prisma.conversation.findMany({
      where: {
        participants: { some: { userId } },
        ...(query.type ? { isGroup: query.type === "group" } : {}),
      },
      include: participantInclude,
      orderBy: { updatedAt: "desc" },
    });

    let data = conversations.map((c) => serializeConversation(c, userId));
    if (query.search) {
      const q = query.search.toLowerCase();
      data = data.filter(
        (c) =>
          c.name?.toLowerCase().includes(q) ||
          c.preview?.toLowerCase().includes(q),
      );
    }
    return { data };
  },

  async getMessages(
    userId: string,
    conversationId: string,
    query: { page: number; pageSize: number; sort: "asc" | "desc" },
  ) {
    await assertMembership(conversationId, userId);
    const { skip, take } = toPrismaPagination(query.page, query.pageSize);

    const [rows, total] = await prisma.$transaction([
      prisma.message.findMany({
        where: { conversationId },
        include: { sender: { include: { profile: true } } },
        orderBy: { createdAt: "desc" },
        skip,
        take,
      }),
      prisma.message.count({ where: { conversationId } }),
    ]);

    // Mark conversation as read up to now.
    await prisma.conversationParticipant.update({
      where: { conversationId_userId: { conversationId, userId } },
      data: { lastReadAt: new Date() },
    });

    const data = rows
      .map((m) => ({
        id: m.id,
        body: m.body,
        from: m.senderId === userId ? "me" : "them",
        senderId: m.senderId,
        sender: m.sender.profile
          ? `${m.sender.profile.firstName} ${m.sender.profile.lastName}`.trim()
          : m.sender.email,
        time: m.createdAt,
      }))
      .reverse();

    return {
      data,
      meta: buildPaginationMeta(query.page, query.pageSize, total),
    };
  },

  /** Reuses an existing 1:1 conversation or creates one, then posts a message. */
  async startDirect(userId: string, participantId: string, message: string) {
    if (userId === participantId)
      throw new BadRequestError("You cannot message yourself");
    const target = await prisma.user.findUnique({
      where: { id: participantId },
    });
    if (!target) throw new NotFoundError("User not found");

    const existing = await prisma.conversation.findFirst({
      where: {
        isGroup: false,
        AND: [
          { participants: { some: { userId } } },
          { participants: { some: { userId: participantId } } },
        ],
      },
    });

    const conversation =
      existing ??
      (await prisma.conversation.create({
        data: {
          isGroup: false,
          participants: { create: [{ userId }, { userId: participantId }] },
        },
      }));

    await this.sendMessage(userId, conversation.id, message);
    const full = await prisma.conversation.findUniqueOrThrow({
      where: { id: conversation.id },
      include: participantInclude,
    });
    return serializeConversation(full, userId);
  },

  async createGroup(userId: string, name: string, participantIds: string[]) {
    const uniqueIds = Array.from(new Set([userId, ...participantIds]));
    const conversation = await prisma.conversation.create({
      data: {
        isGroup: true,
        name,
        participants: { create: uniqueIds.map((id) => ({ userId: id })) },
      },
      include: participantInclude,
    });
    return serializeConversation(conversation, userId);
  },

  async sendMessage(userId: string, conversationId: string, body: string) {
    await assertMembership(conversationId, userId);

    const message = await prisma.message.create({
      data: { conversationId, senderId: userId, body },
    });
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    });

    // Notify other participants.
    const others = await prisma.conversationParticipant.findMany({
      where: { conversationId, userId: { not: userId } },
      include: { conversation: true },
    });
    await prisma.notification.createMany({
      data: others.map((p) => ({
        userId: p.userId,
        type: p.conversation.isGroup
          ? ("GROUP_MESSAGE" as const)
          : ("MESSAGE" as const),
        title: "New message",
        link: `/messages`,
      })),
    });

    return {
      id: message.id,
      body: message.body,
      from: "me" as const,
      senderId: userId,
      time: message.createdAt,
    };
  },

  /** Leave a conversation (removes participant row). */
  async leave(userId: string, conversationId: string) {
    await assertMembership(conversationId, userId);
    await prisma.conversationParticipant.delete({
      where: { conversationId_userId: { conversationId, userId } },
    });

    const remaining = await prisma.conversationParticipant.count({
      where: { conversationId },
    });
    if (remaining === 0) {
      await prisma.conversation.delete({ where: { id: conversationId } });
    }

    return { message: "Left conversation" };
  },

  /** Delete own message. */
  async deleteMessage(
    userId: string,
    conversationId: string,
    messageId: string,
  ) {
    await assertMembership(conversationId, userId);
    const message = await prisma.message.findFirst({
      where: { id: messageId, conversationId },
    });
    if (!message) throw new NotFoundError("Message not found");
    if (message.senderId !== userId) {
      throw new ForbiddenError("You can only delete your own messages");
    }
    await prisma.message.delete({ where: { id: messageId } });
    return { message: "Message deleted" };
  },
};
