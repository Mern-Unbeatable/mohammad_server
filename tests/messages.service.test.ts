import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
      findMany: vi.fn(async () => []),
      count: vi.fn(async () => 0),
      delete: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
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

  describe("editMessage", () => {
    const sent = (overrides: Record<string, unknown> = {}) => ({
      id: "m1",
      conversationId: "c1",
      senderId: "me",
      type: "TEXT",
      event: null,
      body: "helo",
      attachments: [],
      listingId: null,
      listing: null,
      createdAt: new Date("2026-10-18T06:00:00Z"),
      editedAt: null,
      sender: { id: "me", email: "me@lab.eu", profile: { firstName: "Me", lastName: "Lab" } },
      ...overrides,
    });

    beforeEach(() => {
      prismaMock.conversationParticipant.findUnique.mockResolvedValue(membership());
    });

    it("updates the text, stamps editedAt and broadcasts the change", async () => {
      const editedAt = new Date("2026-10-18T06:05:00Z");
      prismaMock.message.findFirst.mockResolvedValue(sent());
      prismaMock.message.update.mockResolvedValue(sent({ body: "hello", editedAt }));
      prismaMock.conversationParticipant.findMany.mockResolvedValue([
        { userId: "me" },
        { userId: "other" },
      ]);

      const result = await messagesService.editMessage("me", "c1", "m1", "hello");

      expect(prismaMock.message.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "m1" },
          data: { body: "hello", editedAt: expect.any(Date) },
        }),
      );
      expect(result).toMatchObject({ body: "hello", editedAt, from: "me" });
      expect(emitToUsers).toHaveBeenCalledWith(["me", "other"], "message:updated", {
        conversationId: "c1",
        message: expect.objectContaining({ id: "m1", body: "hello", editedAt, from: undefined }),
      });
    });

    it("leaves unchanged text alone", async () => {
      prismaMock.message.findFirst.mockResolvedValue(sent());
      const result = await messagesService.editMessage("me", "c1", "m1", "helo");
      expect(result).toMatchObject({ body: "helo", editedAt: null });
      expect(prismaMock.message.update).not.toHaveBeenCalled();
      expect(emitToUsers).not.toHaveBeenCalled();
    });

    it("only lets senders edit their own text messages", async () => {
      prismaMock.message.findFirst.mockResolvedValue(sent({ senderId: "someone-else" }));
      await expect(messagesService.editMessage("me", "c1", "m1", "x")).rejects.toMatchObject({
        statusCode: 403,
      });
      prismaMock.message.findFirst.mockResolvedValue(sent({ type: "SYSTEM" }));
      await expect(messagesService.editMessage("me", "c1", "m1", "x")).rejects.toMatchObject({
        statusCode: 403,
      });
      expect(prismaMock.message.update).not.toHaveBeenCalled();
    });

    it("allows clearing the text only when an attachment or listing remains", async () => {
      prismaMock.message.findFirst.mockResolvedValue(sent());
      await expect(messagesService.editMessage("me", "c1", "m1", "")).rejects.toMatchObject({
        statusCode: 400,
      });

      prismaMock.message.findFirst.mockResolvedValue(sent({ listingId: "l1" }));
      prismaMock.message.update.mockResolvedValue(sent({ body: "", listingId: "l1", editedAt: new Date() }));
      prismaMock.conversationParticipant.findMany.mockResolvedValue([{ userId: "me" }]);
      await expect(messagesService.editMessage("me", "c1", "m1", "")).resolves.toMatchObject({ body: "" });
    });

    it("rejects non-members", async () => {
      prismaMock.conversationParticipant.findUnique.mockResolvedValue(null);
      await expect(messagesService.editMessage("me", "c1", "m1", "x")).rejects.toMatchObject({
        statusCode: 403,
      });
      expect(prismaMock.message.findFirst).not.toHaveBeenCalled();
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

  it("checks membership once when the latest page marks the thread read", async () => {
    prismaMock.conversationParticipant.findUnique.mockResolvedValue(membership());
    prismaMock.conversationParticipant.findMany.mockResolvedValue([{ userId: "me" }]);

    await messagesService.getMessages("me", "c1", { pageSize: 30 } as never);

    expect(prismaMock.conversationParticipant.findUnique).toHaveBeenCalledTimes(1);
    expect(prismaMock.conversationParticipant.update).toHaveBeenCalledWith({
      where: { conversationId_userId: { conversationId: "c1", userId: "me" } },
      data: { lastReadAt: expect.any(Date) },
    });
    expect(emitToUsers).toHaveBeenCalledWith(
      ["me"],
      "conversation:read",
      expect.objectContaining({ conversationId: "c1", userId: "me" }),
    );
  });

  it("still refuses to read a thread the caller is not in", async () => {
    prismaMock.conversationParticipant.findUnique.mockResolvedValue(null);

    await expect(
      messagesService.getMessages("me", "c1", { pageSize: 30 } as never),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(prismaMock.message.findMany).not.toHaveBeenCalled();
    expect(prismaMock.conversationParticipant.update).not.toHaveBeenCalled();
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

describe("messagesService group activity notices", () => {
  const person = (id: string, firstName: string) => ({
    id,
    email: `${id}@lab.io`,
    status: "ACTIVE",
    role: Role.USER,
    profile: { firstName, lastName: "Lab", avatarUrl: null, initials: null },
  });
  const systemRow = (body: string, event: unknown) => ({
    id: "sys1",
    conversationId: "g1",
    senderId: "me",
    type: "SYSTEM",
    event,
    body,
    attachments: [],
    listing: null,
    createdAt: new Date(),
    sender: { email: "me@lab.io", profile: { firstName: "Nayem", lastName: "Lab" } },
  });
  const ownerOf = (name = "Team") =>
    membership({
      conversationId: "g1",
      role: ConversationRole.OWNER,
      conversation: { isGroup: true, name },
    });
  const systemCreate = () =>
    prismaMock.message.create.mock.calls.find(
      ([args]: [{ data: { type?: string } }]) => args.data.type === "SYSTEM",
    )?.[0].data;

  let getConversation: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    prismaMock.$transaction.mockImplementation(async (ops: Promise<unknown>[]) => Promise.all(ops));
    prismaMock.message.create.mockImplementation(async ({ data }: { data: { body: string; event: unknown } }) =>
      systemRow(data.body, data.event),
    );
    getConversation = vi
      .spyOn(messagesService, "getConversation")
      .mockResolvedValue({ id: "g1" } as never);
  });
  afterEach(() => {
    getConversation.mockRestore();
    prismaMock.$transaction.mockReset();
    prismaMock.message.create.mockReset();
  });

  it("posts who added whom and delivers it to every member, new ones included", async () => {
    prismaMock.conversationParticipant.findUnique.mockResolvedValue(ownerOf());
    prismaMock.conversationParticipant.findMany
      .mockResolvedValueOnce([{ userId: "me" }])
      .mockResolvedValue([{ userId: "me" }, { userId: "u2" }, { userId: "u3" }]);
    prismaMock.user.findMany
      .mockResolvedValueOnce([person("u2", "Anna"), person("u3", "Chiara")])
      .mockResolvedValue([person("me", "Nayem"), person("u2", "Anna"), person("u3", "Chiara")]);

    await messagesService.addParticipants("me", "g1", ["u2", "u3"]);

    expect(systemCreate()).toMatchObject({
      conversationId: "g1",
      senderId: "me",
      type: "SYSTEM",
      body: "Nayem Lab added Anna Lab and Chiara Lab",
      event: { action: "added", targetIds: ["u2", "u3"], targetNames: ["Anna Lab", "Chiara Lab"] },
    });
    expect(emitToUsers).toHaveBeenCalledWith(
      ["me", "u2", "u3"],
      "message:new",
      expect.objectContaining({
        conversationId: "g1",
        message: expect.objectContaining({ type: "SYSTEM", body: "Nayem Lab added Anna Lab and Chiara Lab" }),
      }),
    );
  });

  it("posts who removed whom", async () => {
    prismaMock.conversationParticipant.findUnique
      .mockResolvedValueOnce(ownerOf())
      .mockResolvedValueOnce({ id: "cp-u2", userId: "u2" });
    prismaMock.conversationParticipant.findMany.mockResolvedValue([{ userId: "me" }]);
    prismaMock.user.findMany.mockResolvedValue([person("me", "Nayem"), person("u2", "Anna")]);

    await messagesService.removeParticipant("me", "g1", "u2");

    expect(systemCreate()).toMatchObject({
      body: "Nayem Lab removed Anna Lab",
      event: { action: "removed", targetIds: ["u2"], targetNames: ["Anna Lab"] },
    });
  });

  it("posts when someone leaves a group, but not a direct chat", async () => {
    prismaMock.conversationParticipant.findUnique.mockResolvedValue(
      membership({ conversationId: "g1", conversation: { isGroup: true, name: "Team" } }),
    );
    prismaMock.conversationParticipant.findMany.mockResolvedValue([
      { id: "cp2", userId: "u2", role: ConversationRole.OWNER },
    ]);
    prismaMock.user.findMany.mockResolvedValue([person("me", "Nayem")]);

    await messagesService.leave("me", "g1");
    expect(systemCreate()).toMatchObject({ body: "Nayem Lab left the group", event: { action: "left" } });

    prismaMock.message.create.mockClear();
    prismaMock.conversationParticipant.findUnique.mockResolvedValue(membership());
    await messagesService.leave("me", "c1");
    expect(systemCreate()).toBeUndefined();
  });

  it("posts renames, and skips renaming to the same name", async () => {
    prismaMock.conversationParticipant.findUnique.mockResolvedValue(ownerOf("Team"));
    prismaMock.conversationParticipant.findMany.mockResolvedValue([{ userId: "me" }]);
    prismaMock.user.findMany.mockResolvedValue([person("me", "Nayem")]);

    await messagesService.renameGroup("me", "g1", "Team");
    expect(systemCreate()).toBeUndefined();

    await messagesService.renameGroup("me", "g1", "Mofasa");
    expect(systemCreate()).toMatchObject({
      body: 'Nayem Lab renamed the group to "Mofasa"',
      event: { action: "renamed", name: "Mofasa" },
    });
  });

  it("records the creator and initial members when a group is created", async () => {
    prismaMock.user.findMany.mockResolvedValue([
      { id: "u2", status: "ACTIVE" },
      { id: "u3", status: "ACTIVE" },
    ]);
    prismaMock.conversation.create.mockResolvedValue({
      id: "g1",
      isGroup: true,
      name: "Mofasa",
      updatedAt: new Date(),
      participants: [
        { userId: "me", role: ConversationRole.OWNER, user: person("me", "Nayem") },
        { userId: "u2", role: ConversationRole.MEMBER, user: person("u2", "Anna") },
        { userId: "u3", role: ConversationRole.MEMBER, user: person("u3", "Chiara") },
      ],
      messages: [],
    });
    prismaMock.conversationParticipant.findMany.mockResolvedValue([
      { userId: "me" },
      { userId: "u2" },
      { userId: "u3" },
    ]);

    const result = await messagesService.createGroup("me", "Mofasa", ["u2", "u3"]);

    expect(systemCreate()).toMatchObject({
      body: 'Nayem Lab created the group "Mofasa" and added Anna Lab and Chiara Lab',
      event: { action: "created", name: "Mofasa", targetIds: ["u2", "u3"] },
    });
    expect(result.preview).toBe('Nayem Lab created the group "Mofasa" and added Anna Lab and Chiara Lab');
  });

  it("does not let anyone delete an activity notice", async () => {
    prismaMock.conversationParticipant.findUnique.mockResolvedValue(membership());
    prismaMock.message.findFirst.mockResolvedValue({ id: "sys1", senderId: "me", type: "SYSTEM" });

    await expect(messagesService.deleteMessage("me", "c1", "sys1")).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(prismaMock.message.delete).not.toHaveBeenCalled();
  });
});

describe("messagesService starting chats with any member", () => {
  const sentMessage = {
    id: "m1",
    conversationId: "c-new",
    senderId: "me",
    body: "Hello",
    attachments: [],
    listing: null,
    createdAt: new Date(),
    sender: { email: "me@example.com", profile: null },
  };

  it("starts a direct chat with an active user the caller is not connected to", async () => {
    prismaMock.user.findMany.mockResolvedValue([{ id: "stranger", status: "ACTIVE" }]);
    prismaMock.conversation.findUnique.mockResolvedValue(null);
    prismaMock.conversation.create.mockResolvedValue({ id: "c-new" });
    prismaMock.conversationParticipant.findUnique.mockResolvedValue(
      membership({ conversationId: "c-new" }),
    );
    prismaMock.$transaction.mockResolvedValue([sentMessage]);
    prismaMock.conversationParticipant.findMany.mockResolvedValue([
      { userId: "me" },
      { userId: "stranger" },
    ]);
    const getConversation = vi
      .spyOn(messagesService, "getConversation")
      .mockResolvedValue({ id: "c-new" } as never);

    await messagesService.startDirect("me", "stranger", "Hello");

    expect(prismaMock.connection.findMany).not.toHaveBeenCalled();
    expect(prismaMock.conversation.create).toHaveBeenCalledWith({
      data: { isGroup: false, directKey: expect.stringContaining("stranger") },
    });
    expect(prismaMock.conversationParticipant.createMany).toHaveBeenCalledWith({
      data: [
        { conversationId: "c-new", userId: "me" },
        { conversationId: "c-new", userId: "stranger" },
      ],
      skipDuplicates: true,
    });
    expect(emitToUsers).toHaveBeenCalledWith(
      ["me", "stranger"],
      "message:new",
      expect.objectContaining({ conversationId: "c-new" }),
    );
    expect(getConversation).toHaveBeenCalledWith("me", "c-new");
    getConversation.mockRestore();
  });

  it.each(["SUSPENDED", "BANNED"])("refuses to start a chat with a %s account", async (status) => {
    prismaMock.user.findMany.mockResolvedValue([{ id: "u2", status }]);
    await expect(messagesService.startDirect("me", "u2", "Hello")).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(prismaMock.conversation.create).not.toHaveBeenCalled();
  });

  it("creates a group with members the owner is not connected to", async () => {
    prismaMock.user.findMany.mockResolvedValue([
      { id: "u2", status: "ACTIVE" },
      { id: "u3", status: "ACTIVE" },
    ]);
    prismaMock.conversation.create.mockResolvedValue({
      id: "g1",
      isGroup: true,
      name: "Lab",
      updatedAt: new Date(),
      createdAt: new Date(),
      participants: [],
      messages: [],
    });

    await messagesService.createGroup("me", "Lab", ["u2", "u3"]);

    expect(prismaMock.connection.findMany).not.toHaveBeenCalled();
    expect(prismaMock.conversation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          participants: {
            create: [
              { userId: "me", role: ConversationRole.OWNER },
              { userId: "u2" },
              { userId: "u3" },
            ],
          },
        }),
      }),
    );
    expect(emitToUsers).toHaveBeenCalledWith(["u2", "u3"], "conversation:new", {
      conversationId: "g1",
    });
  });
});

describe("messagesService.listRecipients", () => {
  it.each([Role.USER, Role.SUPPLIER, Role.ADMIN])(
    "lets a %s pick any other active user, connected or not",
    async (role) => {
      prismaMock.user.findMany.mockResolvedValue([]);
      await messagesService.listRecipients({ id: "me", role }, { pageSize: 50 });

      expect(prismaMock.connection.findMany).not.toHaveBeenCalled();
      const where = prismaMock.user.findMany.mock.calls[0][0].where;
      expect(where.AND[0]).toEqual({ id: { not: "me" }, status: "ACTIVE" });
    },
  );

  it("finds a non-connected member by the first letter of their name", async () => {
    prismaMock.user.findMany.mockResolvedValue([
      {
        id: "u2",
        email: "ana@lab.io",
        role: Role.USER,
        profile: { firstName: "Ana", lastName: "Lab", avatarUrl: null, title: null, company: null },
      },
    ]);
    const result = await messagesService.listRecipients(
      { id: "me", role: Role.USER },
      { search: "a", pageSize: 50 },
    );

    const where = prismaMock.user.findMany.mock.calls[0][0].where;
    expect(JSON.stringify(where.AND[1])).toContain('"contains":"a"');
    expect(result.data).toEqual([expect.objectContaining({ id: "u2", name: "Ana Lab" })]);
  });
});
