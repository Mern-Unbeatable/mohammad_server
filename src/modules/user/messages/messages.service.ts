import {
  ConversationRole,
  ListingStatus,
  MessageType,
  Prisma,
  Role,
  UserStatus,
} from "@prisma/client";
import { prisma } from "@/infrastructure/prisma";
import { env } from "@/config/env";
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from "@/shared/errors/AppError";
import { buildPaginationMeta } from "@/shared/http/apiResponse";
import { toPrismaPagination } from "@/shared/http/pagination";
import { emitToUsers } from "@/realtime/socket";
import {
  attachmentKeysInConversation,
  attachmentKeysOf,
  removeUnreferencedAttachments,
  resolveOutgoingAttachments,
} from "@/shared/chat/attachments";
import {
  CONVERSATION_PAGE_ORDER,
  MESSAGE_PAGE_ORDER,
  conversationPageWhere,
  nextConversationCursor,
  olderMessagesWhere,
} from "@/shared/chat/pagination";
import {
  buildDirectKey,
  callInclude,
  chatUserSelect,
  conversationInclude,
  displayNameOf,
  initialsOf,
  messageInclude,
  parseAttachments,
  serializeCall,
  serializeConversation,
  serializeMessage,
  subtitleOf,
  systemEventText,
  type SystemEvent,
} from "@/shared/chat/helpers";
import type {
  CallListQuery,
  ConversationListQuery,
  MessageContent,
  MessageListQuery,
  RecipientsQuery,
  UpdateGroupInput,
} from "./messages.validators";

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
    include: { conversation: { select: { isGroup: true, name: true, avatarUrl: true } } },
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

/** Caller must have checked membership. */
const recordRead = async (userId: string, conversationId: string) => {
  const lastReadAt = new Date();
  await prisma.conversationParticipant.update({
    where: { conversationId_userId: { conversationId, userId } },
    data: { lastReadAt },
  });
  const participants = await participantIdsOf(conversationId);
  // The reader is included so their other tabs/devices can refresh unread state.
  emitToUsers(participants, "conversation:read", {
    conversationId,
    userId,
    lastReadAt,
  });
  return { conversationId, lastReadAt };
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

const namesById = async (ids: string[]): Promise<Map<string, string>> => {
  const users = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: chatUserSelect,
  });
  return new Map(users.map((user) => [user.id, displayNameOf(user)]));
};

/** Records group activity in the thread and pushes it to the current members. */
const postSystemMessage = async (
  conversationId: string,
  actorId: string,
  actorName: string,
  event: SystemEvent,
) => {
  const [message] = await prisma.$transaction([
    prisma.message.create({
      data: {
        conversationId,
        senderId: actorId,
        type: MessageType.SYSTEM,
        body: systemEventText(actorName, event),
        event: event as unknown as Prisma.InputJsonValue,
      },
      include: messageInclude,
    }),
    prisma.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    }),
  ]);
  emitToUsers(await participantIdsOf(conversationId), "message:new", {
    conversationId,
    message: { ...serializeMessage(message, actorId), from: undefined },
  });
  return message;
};

/** Only active listings can be shared; sellers may still reference their own. */
const assertShareableListing = async (listingId: string, userId: string) => {
  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    select: { status: true, sellerId: true },
  });
  if (!listing) throw new NotFoundError("Listing not found");
  if (listing.status !== ListingStatus.ACTIVE && listing.sellerId !== userId) {
    throw new BadRequestError("This listing is no longer available");
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
      AND m."type" = 'TEXT'
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
      AND m."type" = 'TEXT'
      AND (p."lastReadAt" IS NULL OR m."createdAt" > p."lastReadAt")
  `;
  return {
    messages: Number(row?.messages ?? 0),
    conversations: Number(row?.conversations ?? 0),
  };
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
    const { skip } = toPrismaPagination(query.page, query.pageSize);

    const [found, total] = await prisma.$transaction([
      prisma.conversation.findMany({
        where: conversationPageWhere(where, query.cursor),
        include: conversationInclude,
        orderBy: CONVERSATION_PAGE_ORDER,
        skip: query.cursor ? 0 : skip,
        take: query.pageSize + 1,
      }),
      prisma.conversation.count({ where }),
    ]);
    const hasMore = found.length > query.pageSize;
    const rows = found.slice(0, query.pageSize);

    const unread = await unreadCountsFor(
      userId,
      rows.map((row) => row.id),
    );

    return {
      data: rows.map((row) =>
        serializeConversation(row, userId, unread.get(row.id) ?? 0),
      ),
      meta: {
        ...buildPaginationMeta(query.page, query.pageSize, total),
        hasMore,
        nextCursor: nextConversationCursor(rows, hasMore),
      },
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

  /** The caller's existing 1:1 conversation with `otherUserId`, or null. */
  async findDirect(userId: string, otherUserId: string) {
    if (userId === otherUserId) return null;
    const conversation = await prisma.conversation.findFirst({
      where: {
        directKey: buildDirectKey(userId, otherUserId),
        participants: { some: { userId } },
      },
      include: conversationInclude,
    });
    if (!conversation) return null;
    const unread = await unreadCountsFor(userId, [conversation.id]);
    return serializeConversation(conversation, userId, unread.get(conversation.id) ?? 0);
  },

  /** Cursor-paginated thread (oldest→newest within the page). */
  async getMessages(
    userId: string,
    conversationId: string,
    query: MessageListQuery,
  ) {
    await assertMembership(conversationId, userId);

    const rows = await prisma.message.findMany({
      where: { conversationId, ...olderMessagesWhere(query) },
      include: messageInclude,
      orderBy: MESSAGE_PAGE_ORDER,
      take: query.pageSize + 1,
    });

    const hasMore = rows.length > query.pageSize;
    const page = rows.slice(0, query.pageSize).reverse();

    // Opening the latest page counts as reading the conversation.
    if (!query.before) await recordRead(userId, conversationId);

    return {
      data: page.map((message) => serializeMessage(message, userId)),
      meta: { pageSize: query.pageSize, hasMore },
    };
  },

  async markRead(userId: string, conversationId: string) {
    await assertMembership(conversationId, userId);
    return recordRead(userId, conversationId);
  },

  /** WebRTC ICE servers for voice calls; TURN credentials come from server env. */
  iceServers() {
    const servers: { urls: string | string[]; username?: string; credential?: string }[] = [];
    if (env.webrtc.stunUrls.length) servers.push({ urls: env.webrtc.stunUrls });
    if (env.webrtc.turnUrls.length) {
      servers.push({
        urls: env.webrtc.turnUrls,
        username: env.webrtc.turnUsername,
        credential: env.webrtc.turnCredential,
      });
    }
    return { iceServers: servers };
  },

  /** Voice-call history for a conversation (most recent first). */
  async listCalls(userId: string, conversationId: string, query: CallListQuery) {
    await assertMembership(conversationId, userId);
    const { skip, take } = toPrismaPagination(query.page, query.pageSize);
    const [rows, total] = await Promise.all([
      prisma.call.findMany({
        where: { conversationId },
        include: callInclude,
        orderBy: { createdAt: "desc" },
        skip,
        take,
      }),
      prisma.call.count({ where: { conversationId } }),
    ]);
    return {
      data: rows.map((call) => serializeCall(call, userId)),
      meta: buildPaginationMeta(query.page, query.pageSize, total),
    };
  },

  /** Reuses the pair's 1:1 conversation (or creates it), then posts a message. */
  async startDirect(
    userId: string,
    participantId: string,
    message: string,
    listingId?: string,
  ) {
    if (userId === participantId)
      throw new BadRequestError("You cannot message yourself");
    await assertActiveUsers([participantId]);
    // Before creating the conversation, so a bad listing leaves no empty thread.
    if (listingId) await assertShareableListing(listingId, userId);

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
      listingId,
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

    const names = new Map(
      conversation.participants.map((p) => [p.userId, displayNameOf(p.user)]),
    );
    const created = await postSystemMessage(conversation.id, userId, names.get(userId) ?? "", {
      action: "created",
      name,
      targetIds: others,
      targetNames: others.map((id) => names.get(id) ?? ""),
    });

    emitToUsers(others, "conversation:new", { conversationId: conversation.id });
    return serializeConversation({ ...conversation, messages: [created] }, userId, 0);
  },

  async sendMessage(
    userId: string,
    conversationId: string,
    content: MessageContent,
  ) {
    await assertMembership(conversationId, userId);
    if (content.listingId) await assertShareableListing(content.listingId, userId);
    const attachments = await resolveOutgoingAttachments(userId, content.attachments);

    const [message] = await prisma.$transaction([
      prisma.message.create({
        data: {
          conversationId,
          senderId: userId,
          body: content.body,
          attachments: attachments as unknown as Prisma.InputJsonValue,
          listingId: content.listingId ?? null,
        },
        include: messageInclude,
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
      const keys = await attachmentKeysInConversation(conversationId);
      await prisma.conversation.delete({ where: { id: conversationId } });
      await removeUnreferencedAttachments(keys);
      return { conversationId, message: "Left conversation" };
    }

    if (!membership.conversation.isGroup) {
      // Next message between the pair starts a fresh thread.
      await prisma.conversation.update({
        where: { id: conversationId },
        data: { directKey: null },
      });
    } else {
      if (
        membership.role === ConversationRole.OWNER &&
        !remaining.some((p) => p.role === ConversationRole.OWNER)
      ) {
        await prisma.conversationParticipant.update({
          where: { id: remaining[0].id },
          data: { role: ConversationRole.OWNER },
        });
      }
      const names = await namesById([userId]);
      await postSystemMessage(conversationId, userId, names.get(userId) ?? "", {
        action: "left",
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
    if (message.type === MessageType.SYSTEM) {
      throw new ForbiddenError("Group activity notices cannot be deleted");
    }
    if (message.senderId !== userId) {
      throw new ForbiddenError("You can only delete your own messages");
    }
    await prisma.message.delete({ where: { id: messageId } });
    await removeUnreferencedAttachments(attachmentKeysOf(message.attachments));

    emitToUsers(await participantIdsOf(conversationId), "message:deleted", {
      conversationId,
      messageId,
    });
    return { conversationId, messageId, message: "Message deleted" };
  },

  /** Sender-only text edit; the body may be emptied only when an attachment or listing remains. */
  async editMessage(
    userId: string,
    conversationId: string,
    messageId: string,
    body: string,
  ) {
    await assertMembership(conversationId, userId);
    const message = await prisma.message.findFirst({
      where: { id: messageId, conversationId },
      include: messageInclude,
    });
    if (!message) throw new NotFoundError("Message not found");
    if (message.type === MessageType.SYSTEM) {
      throw new ForbiddenError("Group activity notices cannot be edited");
    }
    if (message.senderId !== userId) {
      throw new ForbiddenError("You can only edit your own messages");
    }
    if (!body && parseAttachments(message.attachments).length === 0 && !message.listingId) {
      throw new BadRequestError("A message needs text, an attachment or a listing");
    }
    if (body === message.body) return serializeMessage(message, userId);

    const updated = await prisma.message.update({
      where: { id: messageId },
      data: { body, editedAt: new Date() },
      include: messageInclude,
    });

    emitToUsers(await participantIdsOf(conversationId), "message:updated", {
      conversationId,
      message: { ...serializeMessage(updated, userId), from: undefined },
    });
    return serializeMessage(updated, userId);
  },

  async updateGroup(userId: string, conversationId: string, input: UpdateGroupInput) {
    const owner = await assertGroupOwner(conversationId, userId);
    const renamed = input.name !== undefined && input.name !== owner.conversation.name;
    const photoChanged =
      input.avatar !== undefined && input.avatar !== owner.conversation.avatarUrl;
    if (!renamed && !photoChanged) return this.getConversation(userId, conversationId);

    await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        ...(renamed ? { name: input.name } : {}),
        ...(photoChanged ? { avatarUrl: input.avatar } : {}),
      },
    });
    const names = await namesById([userId]);
    const actorName = names.get(userId) ?? "";
    if (renamed) {
      await postSystemMessage(conversationId, userId, actorName, {
        action: "renamed",
        name: input.name!,
      });
    }
    if (photoChanged) {
      await postSystemMessage(conversationId, userId, actorName, {
        action: input.avatar ? "photoChanged" : "photoRemoved",
      });
    }
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

    const names = await namesById([userId, ...added]);
    await postSystemMessage(conversationId, userId, names.get(userId) ?? "", {
      action: "added",
      targetIds: added,
      targetNames: added.map((id) => names.get(id) ?? ""),
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

    const names = await namesById([userId, targetUserId]);
    await postSystemMessage(conversationId, userId, names.get(userId) ?? "", {
      action: "removed",
      targetIds: [targetUserId],
      targetNames: [names.get(targetUserId) ?? ""],
    });

    emitToUsers([targetUserId], "conversation:removed", { conversationId });
    emitToUsers(await participantIdsOf(conversationId), "conversation:updated", {
      conversationId,
    });
    return this.getConversation(userId, conversationId);
  },

  /** People the caller can start a conversation with: every other active user. */
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

    const users = await prisma.user.findMany({
      where: {
        AND: [
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
