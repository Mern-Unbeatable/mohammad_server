import type { AddressInfo } from "node:net";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FeedPostType, Prisma, Role } from "@prisma/client";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    feedPost: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
      deleteMany: vi.fn(),
    },
    feedReaction: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      groupBy: vi.fn(),
    },
    subscription: {
      findUnique: vi.fn(async () => ({
        status: "TRIAL",
        plan: "FREE",
        trialDaysTotal: 90,
        startDate: new Date(),
        createdAt: new Date(),
        renewalDate: null,
        stripeSubscriptionId: null,
      })),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/infrastructure/prisma", () => ({ prisma: prismaMock }));

import { feedService } from "@/modules/user/feed/feed.service";
import { feedRoutes } from "@/modules/user/feed/feed.routes";
import { errorHandler } from "@/middleware/errorHandler";
import { signAccessToken } from "@/shared/utils/jwt";

const ORIGINAL_ID = "11111111-1111-4111-8111-111111111111";
const REPOST_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_REPOST_ID = "33333333-3333-4333-8333-333333333333";

type Row = ReturnType<typeof postRow>;

const postRow = (overrides: Record<string, unknown> = {}) => ({
  id: ORIGINAL_ID,
  authorId: "author",
  type: FeedPostType.QUESTION,
  content: "Which centrifuge do you recommend?",
  imageUrl: null as string | null,
  documentUrl: null as string | null,
  isRepost: false,
  sharedPostId: null as string | null,
  createdAt: new Date("2026-10-01T10:00:00Z"),
  updatedAt: new Date("2026-10-01T10:00:00Z"),
  author: { id: "author", profile: null },
  comments: [],
  sharedPost: null as unknown,
  _count: { reactions: 0, comments: 0, reposts: 0 },
  ...overrides,
});

/** In-memory FeedPost table backing the Prisma mock. */
let rows: Row[] = [];

const withRelations = (row: Row) => {
  const original = rows.find((r) => r.id === row.sharedPostId);
  return {
    ...row,
    sharedPost: original ? { ...original, sharedPost: undefined } : null,
    _count: {
      ...row._count,
      reposts: rows.filter((r) => r.sharedPostId === row.id).length,
    },
  };
};

const findByUniqueKey = (key: { authorId: string; sharedPostId: string }) =>
  rows.find(
    (r) => r.authorId === key.authorId && r.sharedPostId === key.sharedPostId,
  ) ?? null;

const p2002 = () =>
  new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "5.22.0",
  });

beforeEach(() => {
  vi.clearAllMocks();
  rows = [postRow()];

  prismaMock.feedPost.findUnique.mockImplementation(async ({ where }) => {
    const row = where.authorId_sharedPostId
      ? findByUniqueKey(where.authorId_sharedPostId)
      : rows.find((r) => r.id === where.id) ?? null;
    return row ? withRelations(row) : null;
  });
  prismaMock.feedPost.findUniqueOrThrow.mockImplementation(async ({ where }) => {
    const row = findByUniqueKey(where.authorId_sharedPostId);
    if (!row) throw new Error("not found");
    return withRelations(row);
  });
  prismaMock.feedPost.findMany.mockImplementation(async ({ where }) => {
    if (where?.sharedPostId?.in) {
      return rows.filter(
        (r) => r.authorId === where.authorId && where.sharedPostId.in.includes(r.sharedPostId),
      );
    }
    return rows
      .filter((r) => !where?.authorId || r.authorId === where.authorId)
      .filter((r) => !where?.type || r.type === where.type)
      .map(withRelations);
  });
  prismaMock.feedPost.create.mockImplementation(async ({ data }) => {
    if (findByUniqueKey(data)) throw p2002();
    const row = postRow({
      id: rows.length === 1 ? REPOST_ID : OTHER_REPOST_ID,
      author: { id: data.authorId, profile: null },
      ...data,
    });
    rows.push(row);
    return withRelations(row);
  });
  prismaMock.feedPost.count.mockImplementation(async ({ where }) =>
    rows.filter((r) =>
      where?.sharedPostId ? r.sharedPostId === where.sharedPostId : true,
    ).length,
  );
  prismaMock.feedPost.deleteMany.mockImplementation(async ({ where }) => {
    const before = rows.length;
    rows = rows.filter((r) => !(r.id === where.id && r.authorId === where.authorId));
    return { count: before - rows.length };
  });
  prismaMock.feedReaction.findUnique.mockResolvedValue(null);
  prismaMock.feedReaction.findMany.mockResolvedValue([]);
  prismaMock.feedReaction.groupBy.mockResolvedValue([]);
  prismaMock.$transaction.mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops));
});

describe("feedService.repost", () => {
  it("persists a repost linked to the original with its type and caption", async () => {
    const result = await feedService.repost("me", ORIGINAL_ID, "Worth a read");

    expect(prismaMock.feedPost.create).toHaveBeenCalledWith({
      data: {
        authorId: "me",
        type: FeedPostType.QUESTION,
        content: "Worth a read",
        isRepost: true,
        sharedPostId: ORIGINAL_ID,
      },
      select: { id: true },
    });
    expect(result).toMatchObject({
      created: true,
      reposted: true,
      originalPostId: ORIGINAL_ID,
      shares: 1,
      post: {
        id: REPOST_ID,
        type: FeedPostType.QUESTION,
        content: "Worth a read",
        isRepost: true,
        sharedPostId: ORIGINAL_ID,
        sharedByMe: true,
        sharedPost: { id: ORIGINAL_ID, author: { id: "author" } },
      },
    });
  });

  it("returns the existing repost instead of creating a duplicate", async () => {
    rows.push(postRow({ id: REPOST_ID, authorId: "me", isRepost: true, sharedPostId: ORIGINAL_ID }));

    const result = await feedService.repost("me", ORIGINAL_ID, "");

    expect(prismaMock.feedPost.create).not.toHaveBeenCalled();
    expect(result).toMatchObject({ created: false, shares: 1, post: { id: REPOST_ID } });
  });

  it("recovers when a concurrent request creates the repost first", async () => {
    prismaMock.feedPost.create.mockImplementationOnce(async ({ data }) => {
      rows.push(postRow({ id: REPOST_ID, ...data }));
      throw p2002();
    });

    const result = await feedService.repost("me", ORIGINAL_ID, "");

    expect(result).toMatchObject({ created: false, shares: 1, post: { id: REPOST_ID } });
    expect(rows.filter((r) => r.sharedPostId === ORIGINAL_ID)).toHaveLength(1);
  });

  it("reposting a repost targets the original post", async () => {
    rows.push(postRow({ id: OTHER_REPOST_ID, authorId: "friend", isRepost: true, sharedPostId: ORIGINAL_ID }));

    const result = await feedService.repost("me", OTHER_REPOST_ID, "");

    expect(prismaMock.feedPost.create.mock.calls[0][0].data.sharedPostId).toBe(ORIGINAL_ID);
    expect(result).toMatchObject({ originalPostId: ORIGINAL_ID, shares: 2 });
  });

  it("rejects missing posts and reposts whose original was deleted", async () => {
    await expect(feedService.repost("me", "missing", "")).rejects.toMatchObject({ statusCode: 404 });

    rows.push(postRow({ id: OTHER_REPOST_ID, authorId: "friend", isRepost: true, sharedPostId: null }));
    await expect(feedService.repost("me", OTHER_REPOST_ID, "")).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(prismaMock.feedPost.create).not.toHaveBeenCalled();
  });

  it("does not let authors repost their own post", async () => {
    await expect(feedService.repost("author", ORIGINAL_ID, "")).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(prismaMock.feedPost.create).not.toHaveBeenCalled();
  });
});

describe("feedService.undoRepost", () => {
  it("deletes only the caller's repost and returns the persisted count", async () => {
    rows.push(
      postRow({ id: REPOST_ID, authorId: "me", isRepost: true, sharedPostId: ORIGINAL_ID }),
      postRow({ id: OTHER_REPOST_ID, authorId: "friend", isRepost: true, sharedPostId: ORIGINAL_ID }),
    );

    const result = await feedService.undoRepost("me", ORIGINAL_ID);

    expect(prismaMock.feedPost.deleteMany).toHaveBeenCalledWith({
      where: { id: REPOST_ID, authorId: "me" },
    });
    expect(result).toEqual({
      reposted: false,
      originalPostId: ORIGINAL_ID,
      repostId: REPOST_ID,
      shares: 1,
    });
    expect(rows.some((r) => r.id === OTHER_REPOST_ID)).toBe(true);
  });

  it("is a no-op when the caller has not reposted", async () => {
    const result = await feedService.undoRepost("me", ORIGINAL_ID);

    expect(prismaMock.feedPost.deleteMany).not.toHaveBeenCalled();
    expect(result).toMatchObject({ repostId: null, shares: 0 });
  });
});

describe("feedService.list with reposts", () => {
  it("returns reposts on the reposter's profile with persisted counts", async () => {
    rows.push(postRow({ id: REPOST_ID, authorId: "me", isRepost: true, sharedPostId: ORIGINAL_ID }));

    const mine = await feedService.list("me", { page: 1, pageSize: 5, sort: "desc", mine: true });
    expect(mine.data).toHaveLength(1);
    expect(mine.data[0]).toMatchObject({
      id: REPOST_ID,
      isRepost: true,
      sharedByMe: true,
      sharedPost: { id: ORIGINAL_ID, content: "Which centrifuge do you recommend?" },
    });

    const feed = await feedService.list("me", { page: 1, pageSize: 10, sort: "desc" });
    const original = feed.data.find((post) => post.id === ORIGINAL_ID);
    expect(original).toMatchObject({ stats: { shares: 1 }, sharedByMe: true });
  });

  it("keeps the original type so reposts match the type filter", async () => {
    rows.push(postRow({ id: REPOST_ID, authorId: "me", isRepost: true, sharedPostId: ORIGINAL_ID }));

    const questions = await feedService.list("me", {
      page: 1,
      pageSize: 10,
      sort: "desc",
      type: "question",
    });
    expect(questions.data.map((post) => post.id)).toContain(REPOST_ID);

    const information = await feedService.list("me", {
      page: 1,
      pageSize: 10,
      sort: "desc",
      type: "information",
    });
    expect(information.data).toHaveLength(0);
  });

  it("keeps a repost whose original was deleted, without an embedded post", async () => {
    rows = [postRow({ id: REPOST_ID, authorId: "me", isRepost: true, sharedPostId: null })];

    const result = await feedService.list("me", { page: 1, pageSize: 5, sort: "desc", mine: true });
    expect(result.data[0]).toMatchObject({ isRepost: true, sharedPost: null, sharedByMe: false });
  });
});

describe("feedService.update on reposts", () => {
  it("lets a repost add and then remove its own image and document", async () => {
    rows.push(
      postRow({ id: REPOST_ID, authorId: "me", content: "", isRepost: true, sharedPostId: ORIGINAL_ID }),
    );
    prismaMock.feedPost.update.mockImplementation(async ({ where, data }) => {
      const row = rows.find((r) => r.id === where.id)!;
      Object.assign(row, data);
      return withRelations(row);
    });

    const added = await feedService.update("me", REPOST_ID, {
      imageUrls: ["http://localhost:4000/uploads/x.png", "http://localhost:4000/uploads/y.png"],
      documentUrl: "http://localhost:4000/uploads/x.pdf",
    });
    expect(added).toMatchObject({
      isRepost: true,
      imageUrls: ["http://localhost:4000/uploads/x.png", "http://localhost:4000/uploads/y.png"],
      documentUrl: "http://localhost:4000/uploads/x.pdf",
      sharedPost: { id: ORIGINAL_ID },
    });

    const removed = await feedService.update("me", REPOST_ID, {
      imageUrls: [],
      documentUrl: null,
    });
    expect(removed).toMatchObject({ imageUrls: [], documentUrl: null, content: "" });
  });
});

describe("repost routes", () => {
  let server: ReturnType<express.Express["listen"]>;
  let baseUrl = "";
  const token = signAccessToken({ sub: "me", role: Role.USER, email: "me@example.com" });

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use("/feed", feedRoutes);
    app.use(errorHandler);
    await new Promise<void>((resolve) => {
      server = app.listen(0, resolve);
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/feed`;
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const call = (method: string, path: string, body?: unknown, auth = true) =>
    fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(auth ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  it("requires authentication", async () => {
    const created = await call("POST", `/${ORIGINAL_ID}/repost`, {}, false);
    const removed = await call("DELETE", `/${ORIGINAL_ID}/repost`, undefined, false);

    expect(created.status).toBe(401);
    expect(removed.status).toBe(401);
    expect(prismaMock.feedPost.findUnique).not.toHaveBeenCalled();
  });

  it("validates the post id and caption length", async () => {
    expect((await call("POST", "/not-a-uuid/repost", {})).status).toBe(422);
    expect(
      (await call("POST", `/${ORIGINAL_ID}/repost`, { content: "x".repeat(5001) })).status,
    ).toBe(422);
    expect(prismaMock.feedPost.create).not.toHaveBeenCalled();
  });

  it("returns 201 for a new repost, 200 for a repeat, then removes it", async () => {
    const first = await call("POST", `/${ORIGINAL_ID}/repost`, { content: "  Nice  " });
    expect(first.status).toBe(201);
    const firstBody = await first.json();
    expect(firstBody.data).toMatchObject({
      reposted: true,
      shares: 1,
      post: { content: "Nice", sharedPostId: ORIGINAL_ID },
    });
    expect(firstBody.data).not.toHaveProperty("created");

    const repeat = await call("POST", `/${ORIGINAL_ID}/repost`, {});
    expect(repeat.status).toBe(200);
    expect((await repeat.json()).data.shares).toBe(1);

    const removed = await call("DELETE", `/${ORIGINAL_ID}/repost`);
    expect(removed.status).toBe(200);
    expect((await removed.json()).data).toMatchObject({ reposted: false, shares: 0 });
  });
});
