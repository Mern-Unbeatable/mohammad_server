import { describe, expect, it } from "vitest";
import { ConversationRole, ListingStatus, Role } from "@prisma/client";
import {
  buildDirectKey,
  isOwnUploadUrl,
  joinNames,
  messagesLinkFor,
  systemEventText,
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
  const direct = { isGroup: false, otherUserId: "u2" } as const;
  const group = { isGroup: true, conversationId: "c1" } as const;

  it("points each role at its own chat route", () => {
    expect(messagesLinkFor(Role.USER, direct)).toBe("/chat/messages/u2");
    expect(messagesLinkFor(Role.SUPPLIER, direct)).toBe("/supplier/chat/messages/u2");
    expect(messagesLinkFor(Role.ADMIN, direct)).toBe("/admin/chat/messages/u2");
  });

  it("addresses groups by conversation id", () => {
    expect(messagesLinkFor(Role.USER, group)).toBe("/chat/group/c1");
    expect(messagesLinkFor(Role.ADMIN, group)).toBe("/admin/chat/group/c1");
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

  it("describes a listing-only message", () => {
    expect(previewOf({ body: "", attachments: [], listingId: "l1" })).toBe("Shared a listing");
    expect(previewOf({ body: "Still available?", attachments: [], listingId: "l1" })).toBe(
      "Still available?",
    );
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
    listingId: null,
    listing: null,
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
    expect(result.listing).toBeNull();
  });

  it("exposes the shared listing as a card with the price in currency units", () => {
    const result = serializeMessage(
      {
        ...message,
        listingId: "l1",
        listing: {
          id: "l1",
          title: "HPLC system",
          price: 1250000,
          images: ["http://cdn/hplc.png", "http://cdn/hplc-2.png"],
          status: ListingStatus.ACTIVE,
          sellerId: "b",
        },
      },
      "a",
    );
    expect(result.listing).toEqual({
      id: "l1",
      title: "HPLC system",
      price: 12500,
      image: "http://cdn/hplc.png",
      status: ListingStatus.ACTIVE,
      sellerId: "b",
    });
  });
});

describe("group activity text", () => {
  it("joins names with a cap", () => {
    expect(joinNames(["Anna"])).toBe("Anna");
    expect(joinNames(["Anna", "Ben"])).toBe("Anna and Ben");
    expect(joinNames(["Anna", "Ben", "Cara"])).toBe("Anna, Ben and Cara");
    expect(joinNames(["Anna", "Ben", "Cara", "Dan", "Eve"])).toBe("Anna, Ben and 3 others");
  });

  it("describes each action in the third person", () => {
    expect(systemEventText("Nayem", { action: "added", targetIds: ["a"], targetNames: ["Anna"] })).toBe(
      "Nayem added Anna",
    );
    expect(systemEventText("Admin", { action: "removed", targetIds: ["a"], targetNames: ["Anna"] })).toBe(
      "Admin removed Anna",
    );
    expect(systemEventText("Nayem", { action: "left" })).toBe("Nayem left the group");
    expect(systemEventText("Nayem", { action: "renamed", name: "Mofasa" })).toBe(
      'Nayem renamed the group to "Mofasa"',
    );
    expect(
      systemEventText("Nayem", { action: "created", name: "Mofasa", targetIds: [], targetNames: [] }),
    ).toBe('Nayem created the group "Mofasa"');
  });
});
