import {
  ConnectionStatus,
  ConversationRole,
  NotificationType,
  Prisma,
  Role,
  UserStatus,
} from "@prisma/client";
import { prisma } from "@/infrastructure/prisma";
import { logger } from "@/config/logger";
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from "@/shared/errors/AppError";
import { buildPaginationMeta } from "@/shared/http/apiResponse";
import { toPrismaPagination } from "@/shared/http/pagination";
import { emitToUsers } from "@/realtime/socket";
import {
  buildDirectKey,
  conversationInclude,
  displayNameOf,
  initialsOf,
  messagesLinkFor,
  previewOf,
  serializeConversation,
  serializeMessage,
  subtitleOf,
  truncate,
} from "./messages.helpers";
import type {
  ConversationListQuery,
  MessageContent,
  MessageListQuery,
  RecipientsQuery,
} from "./messages.validators";

const senderInclude = {
  sender: { include: { profile: true } },
} satisfies Prisma.MessageInclude;

/** Every whitespace-separated term must match the user's name or email. */
const userSearchWhere = (search?: string): Prisma.UserWhereInput => {
  const terms = (search ?? "").split(/\s+/).filter(Boolean).slice(0, 3);
  if (terms.length === 0) return {};
  return {
    AND: terms.map((term) => ({
      OR: [
        { email: { contains: term, mode: "insensitive" as const } },
        { profile: { firstName: { contains: term, mode: "insensitive" as const } } },
        { profile: { lastName: { contains: term, mode: "insensitive" as const } } },
      ],
    })),
  };
};

const assertMembership = async (conversationId: string, userId: string) => {
  const participant = await prisma.conversationParticipant.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
    include: { conversation: { select: { isGroup: true, name: true } } },
  });
  if (!participant)
    throw new ForbiddenError("You are not a participant in this conversation");
  return participant;
};

const assertGroupOwner = async (conversationId: string, userId: string) => {
  const participant = await assertMembership(conversationId, userId);
  if (!participant.conversation.isGroup) {
    throw new BadRequestError("Only group conversations can be managed");
  }
  if (participant.role !== ConversationRole.OWNER) {
    throw new ForbiddenError("Only the group owner can do this");
  }
  return participant;
};

const participantIdsOf = async (conversationId: string): Promise<string[]> => {
  const rows = await prisma.conversationParticipant.findMany({
    where: { conversationId },
    select: { userId: true },
  });
  return rows.map((row) => row.userId);
};

const assertActiveUsers = async (ids: string[]) => {
  if (ids.length === 0) return;
  const users = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, status: true },
  });
  if (users.length !== ids.length) throw new NotFoundError("User not found");
  if (users.some((user) => user.status !== UserStatus.ACTIVE)) {
    throw new BadRequestError("Some selected users are not active");
  }
};

/** Unread = messages from others newer than the caller's lastReadAt. */
const unreadCountsFor = async (
  userId: string,
  conversationIds: string[],
): Promise<Map<string, number>> => {
  if (conversationIds.length === 0) return new Map();
  const rows = await prisma.$queryRaw<{ conversationId: string; count: bigint }[]>`
    SELECT m."conversationId", COUNT(*)::bigint AS "count"
    FROM "Message" m
    JOIN "ConversationParticipant" p
      ON p."conversationId" = m."conversationId" AND p."userId" = ${userId}
    WHERE m."senderId" <> ${userId}
      AND (p."lastReadAt" IS NULL OR m."createdAt" > p."lastReadAt")
      AND m."conversationId" IN (${Prisma.join(conversationIds)})
    GROUP BY m."conversationId"
  `;
  return new Map(rows.map((row) => [row.conversationId, Number(row.count)]));
};

const unreadTotalsFor = async (userId: string) => {
  const [row] = await prisma.$queryRaw<{ messages: bigint; conversations: bigint }[]>`
    SELECT COUNT(*)::bigint AS "messages",
           COUNT(DISTINCT m."conversationId")::bigint AS "conversations"
    FROM "Message" m
    JOIN "ConversationParticipant" p
      ON p."conversationId" = m."conversationId" AND p."userId" = ${userId}
    WHERE m."senderId" <> ${userId}
      AND (p."lastReadAt" IS NULL OR m."createdAt" > p."lastReadAt")
  `;
  return {
    messages: Number(row?.messages ?? 0),
    conversations: Number(row?.conversations ?? 0),
  };
};

/**
 * One unread notification per conversation per recipient; later messages
 * don't pile up while the earlier notification is still unread.
 */
const notifyNewMessage = async (params: {
  conversationId: string;
  isGroup: boolean;
  groupName: string | null;
  senderName: string;
  preview: string;
  recipientIds: string[];
}) => {
  if (params.recipientIds.length === 0) return;
  const recipients = await prisma.user.findMany({
    where: { id: { in: params.recipientIds } },
    select: { id: true, role: true },
  });
  const targets = recipients.map((recipient) => ({
    userId: recipient.id,
    link: messagesLinkFor(recipient.role, params.conversationId),
  }));

  const pending = await prisma.notification.findMany({
    where: { read: false, OR: targets },
    select: { userId: true },
  });
  const alreadyNotified = new Set(pending.map((row) => row.userId));

  const data = targets
    .filter((target) => !alreadyNotified.has(target.userId))
    .map((target) => ({
      userId: target.userId,
      type: params.isGroup ? NotificationType.GROUP_MESSAGE : NotificationType.MESSAGE,
      title: params.isGroup
        ? `New message in ${params.groupName ?? "a group"}`
        : `New message from ${params.senderName}`,
      subtitle: params.isGroup
        ? truncate(`${params.senderName}: ${params.preview}`)
        : truncate(params.preview),
      link: target.link,
    }));
  if (data.length > 0) await prisma.notification.createMany({ data });
};

export const messagesService = {
  async listConversations(userId: string, query: ConversationListQuery) {
    const terms = userSearchWhere(query.search);
    const where: Prisma.ConversationWhereInput = {
      participants: { some: { userId } },
      ...(query.type ? { isGroup: query.type === "group" } : {}),
      ...(query.search
        ? {
            OR: [
              {
                isGroup: true,
                name: { contains: query.search, mode: "insensitive" },
              },
              {
                isGroup: false,
                participants: {
                  some: { userId: { not: userId }, user: terms },
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
        include: conversationInclude,
        orderBy: { updatedAt: "desc" },
        skip,
        take,
      }),
      prisma.conversation.count({ where }),
    ]);

    const unread = await unreadCountsFor(
      userId,
      rows.map((row) => row.id),
    );

    return {
      data: rows.map((row) =>
        serializeConversation(row, userId, unread.get(row.id) ?? 0),
      ),
      meta: buildPaginationMeta(query.page, query.pageSize, total),
    };
  },

  /** Totals across every conversation the caller belongs to (nav badge). */
  unreadSummary(userId: string) {
    return unreadTotalsFor(userId);
  },

  async getConversation(userId: string, conversationId: string) {
    await assertMembership(conversationId, userId);
    const conversation = await prisma.conversation.findUniqueOrThrow({
      where: { id: conversationId },
      include: conversationInclude,
    });
    const unread = await unreadCountsFor(userId, [conversationId]);
    return serializeConversation(
      conversation,
      userId,
      unread.get(conversationId) ?? 0,
    );
  },

  /** Cursor-paginated thread (oldest→newest within the page). */
  async getMessages(
    userId: string,
    conversationId: string,
    query: MessageListQuery,
  ) {
    await assertMembership(conversationId, userId);

    const rows = await prisma.message.findMany({
      where: {
        conversationId,
        ...(query.before ? { createdAt: { lt: query.before } } : {}),
      },
      include: senderInclude,
      orderBy: { createdAt: "desc" },
      take: query.pageSize + 1,
    });

    const hasMore = rows.length > query.pageSize;
    const page = rows.slice(0, query.pageSize).reverse();

    // Opening the latest page counts as reading the conversation.
    if (!query.before) await this.markRead(userId, conversationId);

    return {
      data: page.map((message) => serializeMessage(message, userId)),
      meta: { pageSize: query.pageSize, hasMore },
    };
  },

  async markRead(userId: string, conversationId: string) {
    await assertMembership(conversationId, userId);
    const lastReadAt = new Date();
    await prisma.conversationParticipant.update({
      where: { conversationId_userId: { conversationId, userId } },
      data: { lastReadAt },
    });
    // Reading the chat settles its "new message" notification, so the next
    // message notifies again (see notifyNewMessage).
    await prisma.notification.updateMany({
      where: {
        userId,
        read: false,
        type: { in: [NotificationType.MESSAGE, NotificationType.GROUP_MESSAGE] },
        link: { endsWith: `?conversation=${conversationId}` },
      },
      data: { read: true },
    });
    // The reader is included so their other tabs/devices can refresh unread state.
    emitToUsers(await participantIdsOf(conversationId), "conversation:read", {
      conversationId,
      userId,
      lastReadAt,
    });
    return { conversationId, lastReadAt };
  },

  /** Reuses the pair's 1:1 conversation (or creates it), then posts a message. */
  async startDirect(userId: string, participantId: string, message: string) {
    if (userId === participantId)
      throw new BadRequestError("You cannot message yourself");
    await assertActiveUsers([participantId]);

    const directKey = buildDirectKey(userId, participantId);
    let conversation = await prisma.conversation.findUnique({
      where: { directKey },
    });
    if (!conversation) {
      try {
        conversation = await prisma.conversation.create({
          data: { isGroup: false, directKey },
        });
      } catch (error) {
        // A concurrent request created it first.
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          conversation = await prisma.conversation.findUniqueOrThrow({
            where: { directKey },
          });
        } else {
          throw error;
        }
      }
    }

    await prisma.conversationParticipant.createMany({
      data: [
        { conversationId: conversation.id, userId },
        { conversationId: conversation.id, userId: participantId },
      ],
      skipDuplicates: true,
    });

    await this.sendMessage(userId, conversation.id, {
      body: message,
      attachments: [],
    });
    return this.getConversation(userId, conversation.id);
  },

  async createGroup(userId: string, name: string, participantIds: string[]) {
    const others = Array.from(new Set(participantIds)).filter(
      (id) => id !== userId,
    );
    if (others.length === 0) {
      throw new BadRequestError("Add at least one other member to the group");
    }
    await assertActiveUsers(others);

    const conversation = await prisma.conversation.create({
      data: {
        isGroup: true,
        name,
        participants: {
          create: [
            { userId, role: ConversationRole.OWNER },
            ...others.map((id) => ({ userId: id })),
          ],
        },
      },
      include: conversationInclude,
    });

    emitToUsers(others, "conversation:new", { conversationId: conversation.id });
    return serializeConversation(conversation, userId, 0);
  },

  async sendMessage(
    userId: string,
    conversationId: string,
    content: MessageContent,
  ) {
    const membership = await assertMembership(conversationId, userId);

    const [message] = await prisma.$transaction([
      prisma.message.create({
        data: {
          conversationId,
          senderId: userId,
          body: content.body,
          attachments: content.attachments as unknown as Prisma.InputJsonValue,
        },
        include: senderInclude,
      }),
      prisma.conversation.update({
        where: { id: conversationId },
        data: { updatedAt: new Date() },
      }),
    ]);

    const participants = await participantIdsOf(conversationId);
    // `from` is viewer-relative; clients derive it from senderId.
    emitToUsers(participants, "message:new", {
      conversationId,
      message: { ...serializeMessage(message, userId), from: undefined },
    });

    notifyNewMessage({
      conversationId,
      isGroup: membership.conversation.isGroup,
      groupName: membership.conversation.name,
      senderName: displayNameOf(message.sender),
      preview: previewOf(message) ?? "",
      recipientIds: participants.filter((id) => id !== userId),
    }).catch((err) => logger.warn({ err }, "Failed to create message notifications"));

    return serializeMessage(message, userId);
  },

  /** Leave a conversation; the oldest remaining member inherits group ownership. */
  async leave(userId: string, conversationId: string) {
    const membership = await assertMembership(conversationId, userId);

    await prisma.conversationParticipant.delete({
      where: { conversationId_userId: { conversationId, userId } },
    });

    const remaining = await prisma.conversationParticipant.findMany({
      where: { conversationId },
      orderBy: { createdAt: "asc" },
      select: { id: true, userId: true, role: true },
    });

    if (remaining.length === 0) {
      await prisma.conversation.delete({ where: { id: conversationId } });
      return { conversationId, message: "Left conversation" };
    }

    if (!membership.conversation.isGroup) {
      // Next message between the pair starts a fresh thread.
      await prisma.conversation.update({
        where: { id: conversationId },
        data: { directKey: null },
      });
    } else if (
      membership.role === ConversationRole.OWNER &&
      !remaining.some((p) => p.role === ConversationRole.OWNER)
    ) {
      await prisma.conversationParticipant.update({
        where: { id: remaining[0].id },
        data: { role: ConversationRole.OWNER },
      });
    }

    emitToUsers(
      remaining.map((p) => p.userId),
      "conversation:updated",
      { conversationId },
    );
    return { conversationId, message: "Left conversation" };
  },

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

    emitToUsers(await participantIdsOf(conversationId), "message:deleted", {
      conversationId,
      messageId,
    });
    return { conversationId, messageId, message: "Message deleted" };
  },

  async renameGroup(userId: string, conversationId: string, name: string) {
    await assertGroupOwner(conversationId, userId);
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { name },
    });
    emitToUsers(await participantIdsOf(conversationId), "conversation:updated", {
      conversationId,
    });
    return this.getConversation(userId, conversationId);
  },

  async addParticipants(
    userId: string,
    conversationId: string,
    participantIds: string[],
  ) {
    await assertGroupOwner(conversationId, userId);
    const existing = new Set(await participantIdsOf(conversationId));
    const added = Array.from(new Set(participantIds)).filter(
      (id) => !existing.has(id),
    );
    if (added.length === 0) {
      throw new BadRequestError("All selected users are already members");
    }
    await assertActiveUsers(added);

    await prisma.conversationParticipant.createMany({
      data: added.map((id) => ({ conversationId, userId: id })),
      skipDuplicates: true,
    });

    emitToUsers(added, "conversation:new", { conversationId });
    emitToUsers(Array.from(existing), "conversation:updated", { conversationId });
    return this.getConversation(userId, conversationId);
  },

  async removeParticipant(
    userId: string,
    conversationId: string,
    targetUserId: string,
  ) {
    await assertGroupOwner(conversationId, userId);
    if (targetUserId === userId) {
      throw new BadRequestError("Use leave to remove yourself from the group");
    }
    const target = await prisma.conversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId, userId: targetUserId } },
    });
    if (!target) throw new NotFoundError("User is not a member of this group");

    await prisma.conversationParticipant.delete({ where: { id: target.id } });

    emitToUsers([targetUserId], "conversation:removed", { conversationId });
    emitToUsers(await participantIdsOf(conversationId), "conversation:updated", {
      conversationId,
    });
    return this.getConversation(userId, conversationId);
  },

  /**
   * People the caller can start a conversation with: accepted contacts for
   * members and suppliers, every active user for admins.
   */
  async listRecipients(
    user: { id: string; role: Role },
    query: RecipientsQuery,
  ) {
    const toRecipient = (row: Prisma.UserGetPayload<{ include: { profile: true } }>) => ({
      id: row.id,
      name: displayNameOf(row),
      initials: initialsOf(row),
      avatar: row.profile?.avatarUrl ?? null,
      subtitle: subtitleOf(row),
      role: row.role,
    });

    const included =
      query.include && query.include !== user.id
        ? await prisma.user.findFirst({
            where: { id: query.include, status: UserStatus.ACTIVE },
            include: { profile: true },
          })
        : null;

    let scope: Prisma.UserWhereInput = {};
    if (user.role !== Role.ADMIN) {
      const connections = await prisma.connection.findMany({
        where: {
          status: ConnectionStatus.ACCEPTED,
          OR: [{ requesterId: user.id }, { addresseeId: user.id }],
        },
        select: { requesterId: true, addresseeId: true },
      });
      const contactIds = connections.map((c) =>
        c.requesterId === user.id ? c.addresseeId : c.requesterId,
      );
      if (contactIds.length === 0) {
        return { data: included ? [toRecipient(included)] : [] };
      }
      scope = { id: { in: contactIds } };
    }

    const users = await prisma.user.findMany({
      where: {
        AND: [
          scope,
          { id: { not: user.id }, status: UserStatus.ACTIVE },
          userSearchWhere(query.search),
        ],
      },
      include: { profile: true },
      orderBy: [{ profile: { firstName: "asc" } }, { email: "asc" }],
      take: query.pageSize,
    });

    const rows =
      included && !users.some((row) => row.id === included.id)
        ? [included, ...users]
        : users;
    return { data: rows.map(toRecipient) };
  },
};
