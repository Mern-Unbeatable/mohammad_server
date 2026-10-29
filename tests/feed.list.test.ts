import type { AddressInfo } from "node:net";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FeedPostType, Role } from "@prisma/client";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    feedPost: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    feedReaction: {
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

/** The feed is open to every signed-in member, so connection direction must not matter. */
const ME = "00000000-0000-4000-8000-000000000001";
const REQUESTED_BY_ME = "00000000-0000-4000-8000-000000000002";
const REQUESTED_ME = "00000000-0000-4000-8000-000000000003";
const STRANGER = "00000000-0000-4000-8000-000000000004";

type Row = ReturnType<typeof postRow>;
type Where = { authorId?: string; type?: FeedPostType; sharedPostId?: { in: string[] } };
type Order = Partial<Record<"createdAt" | "id", "asc" | "desc">>;

const postRow = (id: string, authorId: string, createdAt: string, type = FeedPostType.INFORMATION) => ({
  id,
  authorId,
  type,
  content: `post ${id}`,
  imageUrl: null as string | null,
  imageUrls: [] as string[],
  documentUrl: null as string | null,
  isRepost: false,
  sharedPostId: null as string | null,
  createdAt: new Date(createdAt),
  updatedAt: new Date(createdAt),
  author: { id: authorId, profile: null },
  comments: [],
  sharedPost: null,
  _count: { reactions: 0, comments: 0, reposts: 0 },
});

let rows: Row[] = [];

const matches = (where: Where | undefined) => (row: Row) =>
  (!where?.authorId || row.authorId === where.authorId) &&
  (!where?.type || row.type === where.type);

const compare = (orderBy: Order | Order[]) => (a: Row, b: Row) => {
  for (const order of [orderBy].flat()) {
    const [field, dir] = Object.entries(order)[0] as ["createdAt" | "id", "asc" | "desc"];
    const left = field === "createdAt" ? a.createdAt.getTime() : a.id;
    const right = field === "createdAt" ? b.createdAt.getTime() : b.id;
    if (left !== right) return (left < right ? -1 : 1) * (dir === "asc" ? 1 : -1);
  }
  return 0;
};

beforeEach(() => {
  vi.clearAllMocks();
  rows = [];

  prismaMock.feedPost.findMany.mockImplementation(
    async ({ where, orderBy, skip = 0, take }: { where?: Where; orderBy?: Order | Order[]; skip?: number; take?: number }) => {
      if (where?.sharedPostId?.in) return [];
      const sorted = rows.filter(matches(where)).sort(compare(orderBy ?? []));
      return sorted.slice(skip, take === undefined ? undefined : skip + take);
    },
  );
  prismaMock.feedPost.count.mockImplementation(
    async ({ where }: { where?: Where }) => rows.filter(matches(where)).length,
  );
  prismaMock.feedReaction.findMany.mockResolvedValue([]);
  prismaMock.feedReaction.groupBy.mockResolvedValue([]);
  prismaMock.$transaction.mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops));
});

const listAll = async (query: Record<string, unknown> = {}, pageSize = 2) => {
  const pages: string[][] = [];
  let totalPages = 1;
  for (let page = 1; page <= totalPages; page += 1) {
    const result = await feedService.list(ME, { page, pageSize, sort: "desc", ...query });
    totalPages = result.meta.totalPages;
    pages.push(result.data.map((post) => post.id));
  }
  return pages;
};

describe("feedService.list for connected members", () => {
  beforeEach(() => {
    rows = [
      postRow("p1", REQUESTED_ME, "2026-10-01T09:00:00Z"),
      postRow("p2", REQUESTED_BY_ME, "2026-10-02T09:00:00Z"),
      postRow("p3", STRANGER, "2026-10-03T09:00:00Z"),
      postRow("p4", ME, "2026-10-04T09:00:00Z"),
      postRow("p5", REQUESTED_ME, "2026-10-05T09:00:00Z"),
    ];
  });

  it("includes posts from connections in both request directions, newest first", async () => {
    const result = await feedService.list(ME, { page: 1, pageSize: 10, sort: "desc" });

    expect(result.data.map((post) => post.id)).toEqual(["p5", "p4", "p3", "p2", "p1"]);
    expect(result.data.map((post) => post.author.id)).toEqual(
      expect.arrayContaining([REQUESTED_BY_ME, REQUESTED_ME, ME, STRANGER]),
    );
    expect(result.meta).toMatchObject({ total: 5, totalPages: 1 });
  });

  it("returns every post exactly once across pages, including the oldest ones", async () => {
    const pages = await listAll();

    expect(pages).toEqual([["p5", "p4"], ["p3", "p2"], ["p1"]]);
    expect(new Set(pages.flat()).size).toBe(rows.length);
  });

  it("keeps posts created in the same instant on exactly one page", async () => {
    const instant = "2026-10-06T12:00:00Z";
    rows = ["t3", "t1", "t5", "t2", "t4"].map((id, i) =>
      postRow(id, i % 2 ? REQUESTED_BY_ME : REQUESTED_ME, instant),
    );

    const pages = await listAll();

    expect(pages.flat()).toEqual(["t5", "t4", "t3", "t2", "t1"]);
    expect(prismaMock.feedPost.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ createdAt: "desc" }, { id: "desc" }] }),
    );
  });
});

describe("feedService.list for profile pages", () => {
  beforeEach(() => {
    rows = [
      postRow("a1", REQUESTED_BY_ME, "2026-10-01T09:00:00Z", FeedPostType.QUESTION),
      postRow("m1", ME, "2026-10-02T09:00:00Z"),
      postRow("a2", REQUESTED_BY_ME, "2026-10-03T09:00:00Z"),
      postRow("s1", STRANGER, "2026-10-04T09:00:00Z"),
      postRow("a3", REQUESTED_BY_ME, "2026-10-05T09:00:00Z"),
      postRow("b1", REQUESTED_ME, "2026-10-06T09:00:00Z"),
    ];
  });

  it("lists only the requested author's posts, paginated newest first", async () => {
    const pages = await listAll({ authorId: REQUESTED_BY_ME });

    expect(pages).toEqual([["a3", "a2"], ["a1"]]);
    expect(prismaMock.feedPost.count).toHaveBeenCalledWith({ where: { authorId: REQUESTED_BY_ME } });
  });

  it("serves both connection directions and non-connected members with the feed's rules", async () => {
    const requestedMe = await feedService.list(ME, { page: 1, pageSize: 10, sort: "desc", authorId: REQUESTED_ME });
    const stranger = await feedService.list(ME, { page: 1, pageSize: 10, sort: "desc", authorId: STRANGER });

    expect(requestedMe.data.map((post) => post.id)).toEqual(["b1"]);
    expect(stranger.data.map((post) => post.id)).toEqual(["s1"]);
  });

  it("returns the viewer's own posts for `mine`, which wins over a different authorId", async () => {
    const own = await feedService.list(ME, { page: 1, pageSize: 10, sort: "desc", mine: true });
    const conflicting = await feedService.list(ME, {
      page: 1,
      pageSize: 10,
      sort: "desc",
      mine: true,
      authorId: STRANGER,
    });

    expect(own.data.map((post) => post.id)).toEqual(["m1"]);
    expect(conflicting.data.map((post) => post.id)).toEqual(["m1"]);
  });

  it("combines the author and type filters", async () => {
    const result = await feedService.list(ME, {
      page: 1,
      pageSize: 10,
      sort: "desc",
      type: "question",
      authorId: REQUESTED_BY_ME,
    });

    expect(result.data.map((post) => post.id)).toEqual(["a1"]);
  });

  it("returns an empty page for a member without posts", async () => {
    const result = await feedService.list(ME, {
      page: 1,
      pageSize: 10,
      sort: "desc",
      authorId: "00000000-0000-4000-8000-000000000099",
    });

    expect(result.data).toEqual([]);
    expect(result.meta).toMatchObject({ total: 0 });
  });
});

describe("GET /feed", () => {
  let server: ReturnType<express.Express["listen"]>;
  let baseUrl = "";
  const token = signAccessToken({ sub: ME, role: Role.USER, email: "me@example.com" });

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

  beforeEach(() => {
    rows = [
      postRow("a1", REQUESTED_BY_ME, "2026-10-01T09:00:00Z"),
      postRow("s1", STRANGER, "2026-10-02T09:00:00Z"),
    ];
  });

  const get = (query: string, auth = true) =>
    fetch(`${baseUrl}${query}`, {
      headers: auth ? { authorization: `Bearer ${token}` } : {},
    });

  it("requires authentication", async () => {
    expect((await get(`?authorId=${STRANGER}`, false)).status).toBe(401);
    expect(prismaMock.feedPost.findMany).not.toHaveBeenCalled();
  });

  it("filters by authorId", async () => {
    const response = await get(`?page=1&pageSize=10&sort=desc&authorId=${REQUESTED_BY_ME}`);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.map((post: { id: string }) => post.id)).toEqual(["a1"]);
    expect(body.meta).toMatchObject({ page: 1, pageSize: 10, total: 1 });
  });

  it("rejects an authorId that is not a uuid", async () => {
    expect((await get("?authorId=not-a-user")).status).toBe(422);
    expect(prismaMock.feedPost.findMany).not.toHaveBeenCalled();
  });
});
