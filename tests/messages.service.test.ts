import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConversationRole, Role } from "@prisma/client";

const { prismaMock, emitToUsers } = vi.hoisted(() => ({
  prismaMock: {
    conversationParticipant: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      delete: vi.fn(),
      update: vi.fn(),
      createMany: vi.fn(),
    },
    conversation: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    message: {
      findFirst: vi.fn(),
      delete: vi.fn(),
      create: vi.fn(),
    },
    user: { findMany: vi.fn() },
    connection: { findMany: vi.fn() },
    notification: { findMany: vi.fn(), createMany: vi.fn() },
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
  },
  emitToUsers: vi.fn(),
}));

vi.mock("@/infrastructure/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/realtime/socket", () => ({ emitToUsers }));

import { messagesService } from "@/modules/user/messages/messages.service";

const membership = (overrides: Record<string, unknown> = {}) => ({
  id: "cp1",
  conversationId: "c1",
  userId: "me",
  role: ConversationRole.MEMBER,
  lastReadAt: null,
  createdAt: new Date(),
  conversation: { isGroup: false, name: null },
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("messagesService permissions", () => {
  it("rejects sending to a conversation the caller is not in", async () => {
    prismaMock.conversationParticipant.findUnique.mockResolvedValue(null);
    await expect(
      messagesService.sendMessage("me", "c1", { body: "hi", attachments: [] }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(prismaMock.message.create).not.toHaveBeenCalled();
  });

  it("only lets senders delete their own messages", async () => {
    prismaMock.conversationParticipant.findUnique.mockResolvedValue(membership());
    prismaMock.message.findFirst.mockResolvedValue({ id: "m1", senderId: "someone-else" });
    await expect(
      messagesService.deleteMessage("me", "c1", "m1"),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(prismaMock.message.delete).not.toHaveBeenCalled();
  });

  it("broadcasts deletions to every participant", async () => {
    prismaMock.conversationParticipant.findUnique.mockResolvedValue(membership());
    prismaMock.message.findFirst.mockResolvedValue({ id: "m1", senderId: "me" });
    prismaMock.conversationParticipant.findMany.mockResolvedValue([
      { userId: "me" },
      { userId: "other" },
    ]);
    await messagesService.deleteMessage("me", "c1", "m1");
    expect(emitToUsers).toHaveBeenCalledWith(["me", "other"], "message:deleted", {
      conversationId: "c1",
      messageId: "m1",
    });
  });

  it("refuses to start a direct chat with yourself", async () => {
    await expect(
      messagesService.startDirect("me", "me", "hi"),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("requires at least one other member when creating a group", async () => {
    await expect(
      messagesService.createGroup("me", "Solo", ["me"]),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(prismaMock.conversation.create).not.toHaveBeenCalled();
  });

  it("rejects group members that do not exist", async () => {
    prismaMock.user.findMany.mockResolvedValue([]);
    await expect(
      messagesService.createGroup("me", "Team", ["ghost"]),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("only lets the group owner rename or remove members", async () => {
    prismaMock.conversationParticipant.findUnique.mockResolvedValue(
      membership({ conversation: { isGroup: true, name: "Team" } }),
    );
    await expect(
      messagesService.renameGroup("me", "c1", "New name"),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      messagesService.removeParticipant("me", "c1", "other"),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("does not allow managing a direct conversation", async () => {
    prismaMock.conversationParticipant.findUnique.mockResolvedValue(
      membership({ role: ConversationRole.OWNER }),
    );
    await expect(
      messagesService.renameGroup("me", "c1", "Name"),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe("messagesService chat notifications", () => {
  it("delivers messages without creating notifications", async () => {
    prismaMock.conversationParticipant.findUnique.mockResolvedValue(membership());
    prismaMock.$transaction.mockResolvedValue([
      {
        id: "m1",
        conversationId: "c1",
        senderId: "me",
        body: "hi",
        attachments: [],
        listing: null,
        createdAt: new Date(),
        sender: { email: "me@example.com", profile: null },
      },
    ]);
    prismaMock.conversationParticipant.findMany.mockResolvedValue([
      { userId: "me" },
      { userId: "other" },
    ]);

    await messagesService.sendMessage("me", "c1", { body: "hi", attachments: [] });

    expect(emitToUsers).toHaveBeenCalledWith(["me", "other"], "message:new", expect.anything());
    expect(prismaMock.notification.createMany).not.toHaveBeenCalled();
  });

  it("marks a conversation read without touching notifications", async () => {
    prismaMock.conversationParticipant.findUnique.mockResolvedValue(membership());
    prismaMock.conversationParticipant.findMany.mockResolvedValue([
      { userId: "me" },
      { userId: "other" },
    ]);

    await messagesService.markRead("me", "c1");

    expect(emitToUsers).toHaveBeenCalledWith(
      ["me", "other"],
      "conversation:read",
      expect.objectContaining({ conversationId: "c1", userId: "me" }),
    );
    expect(emitToUsers).not.toHaveBeenCalledWith(
      expect.anything(),
      "notification:updated",
      expect.anything(),
    );
  });
});

describe("messagesService.leave", () => {
  it("hands group ownership to the oldest remaining member", async () => {
    prismaMock.conversationParticipant.findUnique.mockResolvedValue(
      membership({
        role: ConversationRole.OWNER,
        conversation: { isGroup: true, name: "Team" },
      }),
    );
    prismaMock.conversationParticipant.findMany.mockResolvedValue([
      { id: "cp2", userId: "u2", role: ConversationRole.MEMBER },
      { id: "cp3", userId: "u3", role: ConversationRole.MEMBER },
    ]);

    await messagesService.leave("me", "c1");

    expect(prismaMock.conversationParticipant.update).toHaveBeenCalledWith({
      where: { id: "cp2" },
      data: { role: ConversationRole.OWNER },
    });
    expect(emitToUsers).toHaveBeenCalledWith(["u2", "u3"], "conversation:updated", {
      conversationId: "c1",
    });
  });

  it("clears the direct key so the pair can start a fresh thread", async () => {
    prismaMock.conversationParticipant.findUnique.mockResolvedValue(membership());
    prismaMock.conversationParticipant.findMany.mockResolvedValue([
      { id: "cp2", userId: "u2", role: ConversationRole.MEMBER },
    ]);

    await messagesService.leave("me", "c1");

    expect(prismaMock.conversation.update).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { directKey: null },
    });
  });

  it("deletes the conversation when the last member leaves", async () => {
    prismaMock.conversationParticipant.findUnique.mockResolvedValue(membership());
    prismaMock.conversationParticipant.findMany.mockResolvedValue([]);

    await messagesService.leave("me", "c1");

    expect(prismaMock.conversation.delete).toHaveBeenCalledWith({ where: { id: "c1" } });
  });
});

describe("messagesService.listRecipients", () => {
  it("returns nobody for members without accepted contacts", async () => {
    prismaMock.connection.findMany.mockResolvedValue([]);
    const result = await messagesService.listRecipients(
      { id: "me", role: Role.USER },
      { pageSize: 50 },
    );
    expect(result.data).toEqual([]);
    expect(prismaMock.user.findMany).not.toHaveBeenCalled();
  });

  it("limits members to their accepted contacts", async () => {
    prismaMock.connection.findMany.mockResolvedValue([
      { requesterId: "me", addresseeId: "c1" },
      { requesterId: "c2", addresseeId: "me" },
    ]);
    prismaMock.user.findMany.mockResolvedValue([]);
    await messagesService.listRecipients({ id: "me", role: Role.SUPPLIER }, { pageSize: 50 });
    const where = prismaMock.user.findMany.mock.calls[0][0].where;
    expect(where.AND[0]).toEqual({ id: { in: ["c1", "c2"] } });
  });

  it("lets admins pick any active user", async () => {
    prismaMock.user.findMany.mockResolvedValue([]);
    await messagesService.listRecipients({ id: "admin", role: Role.ADMIN }, { pageSize: 50 });
    expect(prismaMock.connection.findMany).not.toHaveBeenCalled();
    const where = prismaMock.user.findMany.mock.calls[0][0].where;
    expect(where.AND[0]).toEqual({});
  });
});
