import { describe, expect, it } from "vitest";
import { ConversationRole, Role } from "@prisma/client";
import {
  buildDirectKey,
  isOwnUploadUrl,
  messagesLinkFor,
  previewOf,
  serializeConversation,
  serializeMessage,
  truncate,
  type ConversationWithRelations,
} from "@/modules/user/messages/messages.helpers";

const makeUser = (id: string, firstName: string, lastName: string) => ({
  id,
  email: `${firstName.toLowerCase()}@example.com`,
  passwordHash: "x",
  role: Role.USER,
  profileType: "LABORATORY" as const,
  status: "ACTIVE" as const,
  warnings: 0,
  lastLoginAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  profile: {
    id: `p-${id}`,
    userId: id,
    firstName,
    lastName,
    title: "QC Lead",
    company: "Novagen",
    country: null,
    location: null,
    phone: null,
    about: null,
    aboutExtended: null,
    avatarUrl: `http://cdn/${id}.png`,
    coverUrl: null,
    initials: null,
    connectionsCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
});

const makeParticipant = (
  conversationId: string,
  user: ReturnType<typeof makeUser>,
  role: ConversationRole = ConversationRole.MEMBER,
) => ({
  id: `cp-${user.id}`,
  conversationId,
  userId: user.id,
  role,
  lastReadAt: null,
  createdAt: new Date(),
  user,
});

const alice = makeUser("a", "Alice", "Martin");
const bob = makeUser("b", "Bob", "Stone");

const makeConversation = (
  overrides: Partial<ConversationWithRelations> = {},
): ConversationWithRelations => ({
  id: "c1",
  isGroup: false,
  name: null,
  directKey: "a:b",
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-02"),
  participants: [makeParticipant("c1", alice), makeParticipant("c1", bob)],
  messages: [],
  ...overrides,
});

describe("buildDirectKey", () => {
  it("is the same regardless of argument order", () => {
    expect(buildDirectKey("b", "a")).toBe("a:b");
    expect(buildDirectKey("a", "b")).toBe("a:b");
  });
});

describe("messagesLinkFor", () => {
  it("points each role at its own inbox route", () => {
    expect(messagesLinkFor(Role.USER, "c1")).toBe("/messages?conversation=c1");
    expect(messagesLinkFor(Role.SUPPLIER, "c1")).toBe(
      "/supplier/messages?conversation=c1",
    );
    expect(messagesLinkFor(Role.ADMIN, "c1")).toBe("/admin/chat?conversation=c1");
  });
});

describe("truncate", () => {
  it("keeps short text and shortens long text with an ellipsis", () => {
    expect(truncate("hello", 10)).toBe("hello");
    expect(truncate("abcdefghijkl", 6)).toBe("abcde…");
  });
});

describe("isOwnUploadUrl", () => {
  it("accepts only files served from this server's upload dir", () => {
    expect(isOwnUploadUrl("http://localhost:4000/uploads/file.png")).toBe(true);
    expect(isOwnUploadUrl("https://evil.example.com/uploads/file.png")).toBe(false);
    expect(isOwnUploadUrl("http://localhost:4000/other/file.png")).toBe(false);
  });
});

describe("previewOf", () => {
  it("prefers text and falls back to an attachment summary", () => {
    expect(previewOf(undefined)).toBeNull();
    expect(previewOf({ body: "Hi", attachments: [] })).toBe("Hi");
    expect(previewOf({ body: "", attachments: [{}] })).toBe("Sent an attachment");
    expect(previewOf({ body: "", attachments: [{}, {}] })).toBe("Sent 2 attachments");
  });
});

describe("serializeConversation", () => {
  it("describes a direct chat from the viewer's point of view", () => {
    const result = serializeConversation(makeConversation(), "a", 3);
    expect(result).toMatchObject({
      id: "c1",
      isGroup: false,
      name: "Bob Stone",
      subtitle: "QC Lead · Novagen",
      initials: "BS",
      avatar: "http://cdn/b.png",
      otherUserId: "b",
      unreadCount: 3,
      myRole: ConversationRole.MEMBER,
    });
    expect(result.time).toEqual(new Date("2026-01-02"));
  });

  it("uses the last message for preview and time", () => {
    const sentAt = new Date("2026-02-01");
    const result = serializeConversation(
      makeConversation({
        messages: [
          {
            id: "m1",
            conversationId: "c1",
            senderId: "b",
            body: "Latest",
            attachments: [],
            createdAt: sentAt,
          },
        ],
      }),
      "a",
    );
    expect(result.preview).toBe("Latest");
    expect(result.time).toEqual(sentAt);
  });

  it("describes a group with member count and owner role", () => {
    const result = serializeConversation(
      makeConversation({
        isGroup: true,
        name: "QC Team",
        directKey: null,
        participants: [
          makeParticipant("c1", alice, ConversationRole.OWNER),
          makeParticipant("c1", bob),
        ],
      }),
      "a",
    );
    expect(result).toMatchObject({
      name: "QC Team",
      subtitle: "2 members",
      initials: "QC",
      avatar: null,
      otherUserId: null,
      myRole: ConversationRole.OWNER,
    });
  });

  it("handles a direct chat whose partner has left", () => {
    const result = serializeConversation(
      makeConversation({ participants: [makeParticipant("c1", alice)] }),
      "a",
    );
    expect(result.name).toBe("Former member");
    expect(result.otherUserId).toBeNull();
  });
});

describe("serializeMessage", () => {
  const message = {
    id: "m1",
    conversationId: "c1",
    senderId: "a",
    body: "Hello",
    attachments: [
      { url: "http://localhost:4000/uploads/x.pdf", name: "x.pdf", mimeType: "application/pdf", size: 10 },
    ],
    createdAt: new Date("2026-03-01"),
    sender: alice,
  };

  it("marks the viewer's own messages as 'me'", () => {
    expect(serializeMessage(message, "a").from).toBe("me");
    expect(serializeMessage(message, "b").from).toBe("them");
  });

  it("exposes sender name and attachments", () => {
    const result = serializeMessage(message, "b");
    expect(result.sender).toBe("Alice Martin");
    expect(result.attachments).toHaveLength(1);
    expect(result.time).toEqual(new Date("2026-03-01"));
  });
});
