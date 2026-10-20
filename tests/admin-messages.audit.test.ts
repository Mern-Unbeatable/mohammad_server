import { beforeEach, describe, expect, it, vi } from "vitest";
import { ModerationAction } from "@prisma/client";

const { prismaMock, emitToUsers } = vi.hoisted(() => ({
  emitToUsers: vi.fn(),
  prismaMock: {
    message: {
      findFirst: vi.fn(),
      findMany: vi.fn(async () => []),
      count: vi.fn(async () => 0),
      delete: vi.fn(async () => ({})),
    },
    conversation: { findUnique: vi.fn(), deleteMany: vi.fn(async () => ({ count: 1 })) },
    conversationParticipant: { findMany: vi.fn(async () => [{ userId: "u1" }, { userId: "u2" }]) },
    moderationLog: { create: vi.fn(async () => ({})) },
    $transaction: vi.fn((queries: Promise<unknown>[]) => Promise.all(queries)),
  },
}));

vi.mock("@/infrastructure/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/realtime/socket", () => ({ emitToUsers }));

import { adminMessagesService } from "@/modules/admin/messages/messages.service";

const SECRET_BODY = "my bank PIN is 4321";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("admin message removal audit", () => {
  it("records who removed whose message, atomically with the delete", async () => {
    prismaMock.message.findFirst.mockResolvedValue({
      id: "m1",
      senderId: "author-1",
      body: SECRET_BODY,
      attachments: [],
    });

    await adminMessagesService.deleteMessage("c1", "m1", "admin-1");

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    const [batch] = prismaMock.$transaction.mock.calls[0];
    expect(batch).toHaveLength(2);
    expect(prismaMock.message.delete).toHaveBeenCalledWith({ where: { id: "m1" } });
    expect(prismaMock.moderationLog.create).toHaveBeenCalledWith({
      data: {
        actorId: "admin-1",
        targetUserId: "author-1",
        action: ModerationAction.REMOVE_CONTENT,
        note: "Removed chat message m1 in conversation c1",
      },
    });
    expect(JSON.stringify(prismaMock.moderationLog.create.mock.calls)).not.toContain(SECRET_BODY);
    expect(emitToUsers).toHaveBeenCalledWith(["u1", "u2"], "message:deleted", {
      conversationId: "c1",
      messageId: "m1",
    });
  });

  it("does not log or delete when the message is not in that conversation", async () => {
    prismaMock.message.findFirst.mockResolvedValue(null);

    await expect(adminMessagesService.deleteMessage("c1", "m404", "admin-1")).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(prismaMock.moderationLog.create).not.toHaveBeenCalled();
    expect(prismaMock.message.delete).not.toHaveBeenCalled();
  });

  it("only selects metadata, never the message body, for the audit", async () => {
    prismaMock.message.findFirst.mockResolvedValue({ id: "m1", senderId: "a", attachments: [] });
    await adminMessagesService.deleteMessage("c1", "m1", "admin-1");
    expect(prismaMock.message.findFirst.mock.calls[0][0].select).toEqual({
      id: true,
      senderId: true,
      attachments: true,
    });
  });
});

describe("admin conversation deletion audit", () => {
  it("records the deletion with counts only", async () => {
    prismaMock.conversation.findUnique.mockResolvedValue({ id: "c1", _count: { messages: 7 } });

    await adminMessagesService.deleteConversation("c1", "admin-1");

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(prismaMock.conversation.deleteMany).toHaveBeenCalledWith({ where: { id: "c1" } });
    expect(prismaMock.moderationLog.create).toHaveBeenCalledWith({
      data: {
        actorId: "admin-1",
        targetUserId: null,
        action: ModerationAction.REMOVE_CONTENT,
        note: "Deleted conversation c1 (7 messages, 2 participants)",
      },
    });
    expect(emitToUsers).toHaveBeenCalledWith(["u1", "u2"], "conversation:removed", {
      conversationId: "c1",
    });
  });

  it("does not log a deletion of a conversation that does not exist", async () => {
    prismaMock.conversation.findUnique.mockResolvedValue(null);

    await expect(adminMessagesService.deleteConversation("c404", "admin-1")).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(prismaMock.moderationLog.create).not.toHaveBeenCalled();
    expect(prismaMock.conversation.deleteMany).not.toHaveBeenCalled();
  });
});
