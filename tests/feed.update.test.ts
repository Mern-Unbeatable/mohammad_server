import type { AddressInfo } from "node:net";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FeedPostType, ReactionType, Role } from "@prisma/client";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    feedPost: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    feedReaction: {
      findUnique: vi.fn(),
      groupBy: vi.fn(),
    },
  },
}));

vi.mock("@/infrastructure/prisma", () => ({ prisma: prismaMock }));

import { feedService } from "@/modules/user/feed/feed.service";
import { feedRoutes } from "@/modules/user/feed/feed.routes";
import { createPostSchema, updatePostSchema } from "@/modules/user/feed/feed.validators";
import { errorHandler } from "@/middleware/errorHandler";
import { signAccessToken } from "@/shared/utils/jwt";

const POST_ID = "11111111-1111-4111-8111-111111111111";
const REPOST_ID = "22222222-2222-4222-8222-222222222222";
const CREATED_AT = new Date("2026-10-01T10:00:00Z");
const IMG = (name: string) => `http://localhost:4000/uploads/${name}.png`;

const postRow = (overrides: Record<string, unknown> = {}) => ({
  id: POST_ID,
  authorId: "me",
  type: FeedPostType.QUESTION,
  content: "Which centrifuge do you recommend?",
  imageUrl: null as string | null,
  imageUrls: [] as string[],
  documentUrl: null as string | null,
  isRepost: false,
  sharedPostId: null as string | null,
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
  author: { id: "me", profile: null },
  comments: [],
  sharedPost: null as unknown,
  _count: { reactions: 2, comments: 0, reposts: 0 },
  ...overrides,
});

type Row = ReturnType<typeof postRow>;
let rows: Row[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  rows = [postRow()];

  prismaMock.feedPost.findUnique.mockImplementation(
    async ({ where }) => rows.find((r) => r.id === where.id) ?? null,
  );
  prismaMock.feedPost.findMany.mockResolvedValue([]);
  prismaMock.feedPost.update.mockImplementation(async ({ where, data }) => {
    const row = rows.find((r) => r.id === where.id)!;
    Object.assign(row, data, { updatedAt: new Date("2026-10-02T09:00:00Z") });
    return row;
  });
  prismaMock.feedReaction.findUnique.mockResolvedValue({ type: ReactionType.like });
  prismaMock.feedReaction.groupBy.mockResolvedValue([
    { postId: POST_ID, type: ReactionType.like, _count: { _all: 2 } },
  ]);
});

describe("feedService.update", () => {
  it("saves new content and returns the post with its reactions and edit time", async () => {
    const result = await feedService.update("me", POST_ID, { content: "Updated question" });

    expect(prismaMock.feedPost.update).toHaveBeenCalledWith({
      where: { id: POST_ID },
      data: { content: "Updated question", imageUrls: [], imageUrl: null, documentUrl: null },
    });
    expect(result).toMatchObject({
      id: POST_ID,
      content: "Updated question",
      myReaction: ReactionType.like,
      reactionCounts: { like: 2 },
      stats: { reactions: 2 },
      editedAt: new Date("2026-10-02T09:00:00Z"),
    });
  });

  it("saves several images in order and keeps imageUrl as the first one", async () => {
    const result = await feedService.update("me", POST_ID, {
      imageUrls: [IMG("a"), IMG("b"), IMG("c")],
    });

    expect(prismaMock.feedPost.update.mock.calls[0][0].data).toMatchObject({
      imageUrls: [IMG("a"), IMG("b"), IMG("c")],
      imageUrl: IMG("a"),
    });
    expect(result).toMatchObject({ imageUrls: [IMG("a"), IMG("b"), IMG("c")], imageUrl: IMG("a") });
  });

  it("removes one image of several, and all of them, while keeping the text", async () => {
    rows = [postRow({ imageUrl: IMG("a"), imageUrls: [IMG("a"), IMG("b")] })];

    const one = await feedService.update("me", POST_ID, { imageUrls: [IMG("b")] });
    expect(one).toMatchObject({ imageUrls: [IMG("b")], imageUrl: IMG("b") });

    const none = await feedService.update("me", POST_ID, { imageUrls: [] });
    expect(none).toMatchObject({
      imageUrls: [],
      imageUrl: null,
      content: "Which centrifuge do you recommend?",
    });
  });

  it("reads images from rows written with only the single imageUrl", async () => {
    rows = [postRow({ imageUrl: IMG("old") })];

    const result = await feedService.update("me", POST_ID, { content: "New text" });

    expect(result).toMatchObject({ imageUrls: [IMG("old")], imageUrl: IMG("old") });
    expect(prismaMock.feedPost.update.mock.calls[0][0].data.imageUrls).toEqual([IMG("old")]);
  });

  it("lets an image-only post have no text", async () => {
    rows = [postRow({ content: "Before", imageUrl: IMG("a"), imageUrls: [IMG("a")] })];

    const result = await feedService.update("me", POST_ID, { content: "" });

    expect(result).toMatchObject({ content: "", imageUrls: [IMG("a")] });
  });

  it("rejects an edit that would leave the post empty", async () => {
    rows = [postRow({ imageUrl: IMG("a"), imageUrls: [IMG("a")] })];

    await expect(
      feedService.update("me", POST_ID, { content: "", imageUrls: [] }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(prismaMock.feedPost.update).not.toHaveBeenCalled();
  });

  it("allows clearing a repost caption", async () => {
    rows = [postRow({ id: REPOST_ID, content: "Nice", isRepost: true, sharedPostId: POST_ID })];

    const result = await feedService.update("me", REPOST_ID, { content: "" });

    expect(result).toMatchObject({ id: REPOST_ID, content: "" });
  });

  it("does not write or mark the post edited when nothing changed", async () => {
    rows = [postRow({ imageUrl: IMG("a"), imageUrls: [IMG("a"), IMG("b")] })];

    const result = await feedService.update("me", POST_ID, {
      content: "Which centrifuge do you recommend?",
      imageUrls: [IMG("a"), IMG("b")],
    });

    expect(prismaMock.feedPost.update).not.toHaveBeenCalled();
    expect(result.editedAt).toBeNull();
  });

  it("rejects other authors and missing posts", async () => {
    await expect(
      feedService.update("someone-else", POST_ID, { content: "Hijacked" }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      feedService.update("me", REPOST_ID, { content: "Missing" }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(prismaMock.feedPost.update).not.toHaveBeenCalled();
  });
});

describe("feed post image validation", () => {
  const urls = (count: number) => Array.from({ length: count }, (_, i) => IMG(`p${i}`));

  it("accepts up to 10 images on create and rejects more", () => {
    expect(createPostSchema.parse({ imageUrls: urls(10) }).imageUrls).toHaveLength(10);
    expect(createPostSchema.safeParse({ imageUrls: urls(11) }).success).toBe(false);
    expect(createPostSchema.safeParse({ imageUrls: ["not a url"] }).success).toBe(false);
  });

  it("folds the older single imageUrl into imageUrls", () => {
    expect(createPostSchema.parse({ imageUrl: IMG("a") }).imageUrls).toEqual([IMG("a")]);
    expect(updatePostSchema.parse({ imageUrl: IMG("a") }).imageUrls).toEqual([IMG("a")]);
    expect(updatePostSchema.parse({ imageUrl: null }).imageUrls).toEqual([]);
    expect(updatePostSchema.parse({ content: "x" }).imageUrls).toBeUndefined();
  });

  it("still requires text, an image, or a document on create", () => {
    expect(createPostSchema.safeParse({ content: "" }).success).toBe(false);
    expect(createPostSchema.safeParse({ imageUrls: [] }).success).toBe(false);
  });

  it("stores every image on create with imageUrl as the first", async () => {
    prismaMock.feedPost.create.mockImplementation(async ({ data }) =>
      postRow({ ...data, id: POST_ID }),
    );

    const result = await feedService.create(
      "me",
      createPostSchema.parse({ content: "Lab photos", imageUrls: [IMG("a"), IMG("b")] }),
    );

    expect(prismaMock.feedPost.create.mock.calls[0][0].data).toMatchObject({
      imageUrls: [IMG("a"), IMG("b")],
      imageUrl: IMG("a"),
    });
    expect(result).toMatchObject({ imageUrls: [IMG("a"), IMG("b")], imageUrl: IMG("a") });
  });
});

describe("PATCH /feed/:id", () => {
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

  const patch = (path: string, body: unknown, auth = true) =>
    fetch(`${baseUrl}${path}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        ...(auth ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });

  it("requires authentication", async () => {
    expect((await patch(`/${POST_ID}`, { content: "x" }, false)).status).toBe(401);
    expect(prismaMock.feedPost.findUnique).not.toHaveBeenCalled();
  });

  it("validates the id, content length and URLs", async () => {
    expect((await patch("/not-a-uuid", { content: "x" })).status).toBe(422);
    expect((await patch(`/${POST_ID}`, { content: "x".repeat(5001) })).status).toBe(422);
    expect((await patch(`/${POST_ID}`, { imageUrl: "not a url" })).status).toBe(422);
    const eleven = Array.from({ length: 11 }, (_, i) => IMG(`p${i}`));
    expect((await patch(`/${POST_ID}`, { imageUrls: eleven })).status).toBe(422);
    expect(prismaMock.feedPost.update).not.toHaveBeenCalled();
  });

  it("saves an image list sent over HTTP", async () => {
    const response = await patch(`/${POST_ID}`, { imageUrls: [IMG("a"), IMG("b")] });

    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({ imageUrls: [IMG("a"), IMG("b")] });
  });

  it("trims content and ignores fields that cannot be edited", async () => {
    const response = await patch(`/${POST_ID}`, {
      content: "  Edited  ",
      type: "SUPPLIERS",
      authorId: "someone-else",
    });

    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({
      content: "Edited",
      type: FeedPostType.QUESTION,
      author: { id: "me" },
    });
    expect(prismaMock.feedPost.update.mock.calls[0][0].data).not.toHaveProperty("type");
  });

  it("returns 403 for someone else's post", async () => {
    rows = [postRow({ authorId: "author", author: { id: "author", profile: null } })];

    const response = await patch(`/${POST_ID}`, { content: "Hijacked" });

    expect(response.status).toBe(403);
    expect(prismaMock.feedPost.update).not.toHaveBeenCalled();
  });
});
