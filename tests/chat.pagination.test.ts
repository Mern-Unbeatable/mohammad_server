import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const { prismaMock, emitToUsers } = vi.hoisted(() => ({
  emitToUsers: vi.fn(),
  prismaMock: {
    conversationParticipant: {
      findUnique: vi.fn(),
      findMany: vi.fn(async () => []),
      update: vi.fn(),
    },
    conversation: { findMany: vi.fn(), count: vi.fn(), findUnique: vi.fn() },
    message: { findMany: vi.fn() },
    $transaction: vi.fn((queries: Promise<unknown>[]) => Promise.all(queries)),
    $queryRaw: vi.fn(async () => []),
  },
}));

vi.mock("@/infrastructure/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/realtime/socket", () => ({ emitToUsers }));

import { decodeCursor, encodeCursor } from "@/shared/http/cursor";
import { olderMessagesWhere } from "@/shared/chat/pagination";
import { messagesService } from "@/modules/user/messages/messages.service";
import { adminMessagesService } from "@/modules/admin/messages/messages.service";
import {
  conversationListQuerySchema,
  messageListQuerySchema,
} from "@/modules/user/messages/messages.validators";
import { adminConversationListQuerySchema } from "@/modules/admin/messages/messages.validators";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** Applies the subset of Prisma filters/ordering these queries use to an in-memory table. */
type Row = { id: string; createdAt?: Date; updatedAt?: Date };
const matches = (row: Row, where: Record<string, unknown>): boolean =>
  Object.entries(where).every(([key, condition]) => {
    if (key === "OR") return (condition as Record<string, unknown>[]).some((c) => matches(row, c));
    if (key === "AND") return (condition as Record<string, unknown>[]).every((c) => matches(row, c));
    const value = row[key as keyof Row];
    if (condition && typeof condition === "object" && !(condition instanceof Date)) {
      const lt = (condition as { lt?: Date | string }).lt;
      if (lt === undefined) return true;
      return value instanceof Date ? value < (lt as Date) : String(value) < String(lt);
    }
    if (condition instanceof Date) return (value as Date)?.getTime() === condition.getTime();
    return key === "conversationId" || key === "participants" || value === condition;
  });
const sortDesc = (field: "createdAt" | "updatedAt") => (a: Row, b: Row) =>
  b[field]!.getTime() - a[field]!.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

const at = (minute: number) => new Date(Date.UTC(2026, 9, 20, 10, minute));

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.conversationParticipant.findUnique.mockResolvedValue({
    id: "cp",
    role: "MEMBER",
    conversation: { isGroup: false, name: null },
  });
});

describe("cursor encoding", () => {
  it("round-trips and rejects tampered values", () => {
    const cursor = { at: at(5), id: uuid(1) };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
    expect(decodeCursor("not-a-cursor")).toBeNull();
    expect(decodeCursor(Buffer.from('["2026-01-01T00:00:00Z","x"]').toString("base64url"))).toBeNull();
    expect(() => conversationListQuerySchema.parse({ cursor: "garbage" })).toThrow("Invalid cursor");
    expect(() => adminConversationListQuerySchema.parse({ cursor: "garbage" })).toThrow("Invalid cursor");
  });

  it("keeps the legacy `before`-only message query for older clients", () => {
    expect(olderMessagesWhere({ before: at(5) })).toEqual({ createdAt: { lt: at(5) } });
    expect(olderMessagesWhere({})).toEqual({});
    expect(olderMessagesWhere({ before: at(5), beforeId: uuid(3) })).toEqual({
      OR: [{ createdAt: { lt: at(5) } }, { createdAt: at(5), id: { lt: uuid(3) } }],
    });
  });
});

describe("message thread keyset pagination", () => {
  // Seven messages, several sharing a timestamp (bulk inserts, system notices).
  const table: Row[] = [
    { id: uuid(1), createdAt: at(1) },
    { id: uuid(2), createdAt: at(2) },
    { id: uuid(3), createdAt: at(2) },
    { id: uuid(4), createdAt: at(2) },
    { id: uuid(5), createdAt: at(3) },
    { id: uuid(6), createdAt: at(3) },
    { id: uuid(7), createdAt: at(4) },
  ];
  const asMessage = (row: Row) => ({
    ...row,
    conversationId: "c1",
    senderId: "u2",
    body: row.id,
    attachments: [],
    listingId: null,
    listing: null,
    type: "TEXT",
    event: null,
    editedAt: null,
    sender: { id: "u2", email: "u2@x.test", profile: null },
  });

  beforeEach(() => {
    prismaMock.message.findMany.mockImplementation(
      async ({ where, orderBy, take }: { where: Record<string, unknown>; orderBy: unknown; take: number }) => {
        expect(orderBy).toEqual([{ createdAt: "desc" }, { id: "desc" }]);
        return table.filter((row) => matches(row, where)).sort(sortDesc("createdAt")).slice(0, take).map(asMessage);
      },
    );
  });

  const readAll = async (load: (query: Record<string, unknown>) => Promise<{ data: { id: string; time: Date }[]; meta: { hasMore: boolean } }>) => {
    const seen: string[] = [];
    let query: Record<string, unknown> = { pageSize: 2 };
    for (let guard = 0; guard < 10; guard += 1) {
      const page = await load(query);
      seen.unshift(...page.data.map((m) => m.id));
      if (!page.meta.hasMore) break;
      const oldest = page.data[0];
      query = messageListQuerySchema.parse({
        pageSize: 2,
        before: oldest.time.toISOString(),
        beforeId: oldest.id,
      });
    }
    return seen;
  };

  it("returns every message exactly once for members, even with equal timestamps", async () => {
    const seen = await readAll((query) => messagesService.getMessages("u1", "c1", query as never));
    expect(seen).toEqual(table.map((row) => row.id));
  });

  it("does the same for the admin moderation thread", async () => {
    prismaMock.conversation.findUnique.mockResolvedValue({ id: "c1" });
    const seen = await readAll((query) => adminMessagesService.getMessages("admin", "c1", query as never));
    expect(seen).toEqual(table.map((row) => row.id));
  });
});

describe("conversation list cursor", () => {
  const table: Row[] = [
    { id: uuid(1), updatedAt: at(9) },
    { id: uuid(2), updatedAt: at(8) },
    { id: uuid(3), updatedAt: at(8) },
    { id: uuid(4), updatedAt: at(7) },
    { id: uuid(5), updatedAt: at(6) },
  ];
  const asConversation = (row: Row) => ({
    ...row,
    isGroup: true,
    name: row.id,
    createdAt: at(0),
    participants: [],
    messages: [],
    _count: { messages: 0 },
  });

  beforeEach(() => {
    prismaMock.conversation.count.mockResolvedValue(table.length);
    prismaMock.conversation.findMany.mockImplementation(
      async ({ where, orderBy, skip, take }: { where: Record<string, unknown>; orderBy: unknown; skip: number; take: number }) => {
        expect(orderBy).toEqual([{ updatedAt: "desc" }, { id: "desc" }]);
        return table
          .filter((row) => matches(row, where))
          .sort(sortDesc("updatedAt"))
          .slice(skip, skip + take)
          .map(asConversation);
      },
    );
  });

  it.each([
    ["member inbox", (q: unknown) => messagesService.listConversations("u1", q as never), conversationListQuerySchema],
    ["admin moderation list", (q: unknown) => adminMessagesService.listConversations(q as never), adminConversationListQuerySchema],
  ])("walks the %s with nextCursor and stops on the last page", async (_label, list, schema) => {
    const ids: string[] = [];
    let query = schema.parse({ pageSize: "2" });
    for (let guard = 0; guard < 10; guard += 1) {
      const page = await list(query);
      ids.push(...page.data.map((c: { id: string }) => c.id));
      expect(page.meta.hasMore).toBe(Boolean(page.meta.nextCursor));
      if (!page.meta.nextCursor) break;
      query = schema.parse({ pageSize: "2", cursor: page.meta.nextCursor });
    }
    expect(ids).toEqual([uuid(1), uuid(3), uuid(2), uuid(4), uuid(5)]);
  });

  it("is not shifted when a conversation becomes active between pages", async () => {
    const first = await messagesService.listConversations("u1", conversationListQuerySchema.parse({ pageSize: "2" }));
    // uuid(5) gets a new message: it jumps to the top. Offset paging would now repeat uuid(2).
    table[4].updatedAt = at(30);
    const second = await messagesService.listConversations(
      "u1",
      conversationListQuerySchema.parse({ pageSize: "2", cursor: first.meta.nextCursor }),
    );
    expect(first.data.map((c) => c.id)).toEqual([uuid(1), uuid(3)]);
    expect(second.data.map((c) => c.id)).toEqual([uuid(2), uuid(4)]);
    table[4].updatedAt = at(6);
  });

  it("keeps page-number meta for existing clients", async () => {
    const page = await messagesService.listConversations("u1", conversationListQuerySchema.parse({ pageSize: "2", page: "2" }));
    expect(page.data.map((c) => c.id)).toEqual([uuid(2), uuid(4)]);
    expect(page.meta).toMatchObject({ page: 2, pageSize: 2, total: 5, totalPages: 3, hasMore: true });
  });
});

describe("Prisma type sanity", () => {
  it("uses the generated sort enum values", () => {
    expect(Prisma.SortOrder.desc).toBe("desc");
  });
});
