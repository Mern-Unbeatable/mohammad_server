import type { AddressInfo } from "node:net";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    feedComment: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
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
  },
}));

vi.mock("@/infrastructure/prisma", () => ({ prisma: prismaMock }));

import { feedService } from "@/modules/user/feed/feed.service";
import { feedRoutes } from "@/modules/user/feed/feed.routes";
import { errorHandler } from "@/middleware/errorHandler";
import { signAccessToken } from "@/shared/utils/jwt";

const POST_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_POST_ID = "33333333-3333-4333-8333-333333333333";
const COMMENT_ID = "22222222-2222-4222-8222-222222222222";
const MISSING_ID = "44444444-4444-4444-8444-444444444444";

const commentRow = (overrides: Record<string, unknown> = {}) => ({
  id: COMMENT_ID,
  postId: POST_ID,
  authorId: "me",
  content: "Original comment",
  parentCommentId: null as string | null,
  createdAt: new Date("2026-10-01T10:00:00Z"),
  author: { id: "me", profile: null },
  _count: { likes: 2, replies: 0 },
  likes: [{ id: "like-1" }],
  ...overrides,
});

type Row = ReturnType<typeof commentRow>;
let rows: Row[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  rows = [commentRow()];

  const find = async ({ where }: { where: { id: string } }) =>
    rows.find((r) => r.id === where.id) ?? null;
  prismaMock.feedComment.findUnique.mockImplementation(find);
  prismaMock.feedComment.findUniqueOrThrow.mockImplementation(find);
  prismaMock.feedComment.update.mockImplementation(async ({ where, data }) => {
    const row = rows.find((r) => r.id === where.id)!;
    Object.assign(row, data);
    return row;
  });
  prismaMock.feedComment.delete.mockImplementation(async ({ where }) => {
    rows = rows.filter((r) => r.id !== where.id && r.parentCommentId !== where.id);
  });
  prismaMock.feedComment.count.mockImplementation(async () => rows.length);
});

describe("feedService.updateComment", () => {
  it("saves the new content and keeps likes and thread links", async () => {
    const result = await feedService.updateComment("me", POST_ID, COMMENT_ID, "Edited");

    expect(prismaMock.feedComment.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: COMMENT_ID }, data: { content: "Edited" } }),
    );
    expect(result).toMatchObject({
      id: COMMENT_ID,
      content: "Edited",
      parentCommentId: null,
      likeCount: 2,
      liked: true,
      author: { id: "me" },
    });
  });

  it("does not write when the content is unchanged", async () => {
    const result = await feedService.updateComment("me", POST_ID, COMMENT_ID, "Original comment");

    expect(prismaMock.feedComment.update).not.toHaveBeenCalled();
    expect(result.content).toBe("Original comment");
  });

  it("rejects other users, including admins", async () => {
    await expect(
      feedService.updateComment("someone-else", POST_ID, COMMENT_ID, "Hijacked"),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(prismaMock.feedComment.update).not.toHaveBeenCalled();
  });

  it("returns 404 for a missing comment or one from another post", async () => {
    await expect(
      feedService.updateComment("me", POST_ID, MISSING_ID, "x"),
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(
      feedService.updateComment("me", OTHER_POST_ID, COMMENT_ID, "x"),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(prismaMock.feedComment.update).not.toHaveBeenCalled();
  });
});

describe("feedService.removeComment", () => {
  it("deletes a root comment with its replies and returns the new total", async () => {
    rows = [
      commentRow(),
      commentRow({ id: "reply-1", parentCommentId: COMMENT_ID }),
      commentRow({ id: "reply-2", parentCommentId: COMMENT_ID }),
      commentRow({ id: "other-root" }),
    ];

    const result = await feedService.removeComment("me", Role.USER, POST_ID, COMMENT_ID);

    expect(prismaMock.feedComment.delete).toHaveBeenCalledWith({ where: { id: COMMENT_ID } });
    expect(prismaMock.feedComment.count).toHaveBeenCalledWith({ where: { postId: POST_ID } });
    expect(result).toEqual({ postId: POST_ID, commentId: COMMENT_ID, commentCount: 1 });
  });

  it("lets admins delete other users' comments but not regular users", async () => {
    await expect(
      feedService.removeComment("someone-else", Role.USER, POST_ID, COMMENT_ID),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(prismaMock.feedComment.delete).not.toHaveBeenCalled();

    await feedService.removeComment("admin", Role.ADMIN, POST_ID, COMMENT_ID);
    expect(prismaMock.feedComment.delete).toHaveBeenCalledTimes(1);
  });

  it("returns 404 for a missing comment or one from another post", async () => {
    await expect(
      feedService.removeComment("me", Role.USER, POST_ID, MISSING_ID),
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(
      feedService.removeComment("me", Role.USER, OTHER_POST_ID, COMMENT_ID),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(prismaMock.feedComment.delete).not.toHaveBeenCalled();
  });
});

describe("PATCH and DELETE /feed/:id/comments/:commentId", () => {
  let server: ReturnType<express.Express["listen"]>;
  let baseUrl = "";
  const token = signAccessToken({ sub: "me", role: Role.USER, email: "me@example.com" });
  const otherToken = signAccessToken({
    sub: "someone-else",
    role: Role.USER,
    email: "other@example.com",
  });

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

  const send = (
    method: "PATCH" | "DELETE",
    path: string,
    body?: unknown,
    auth: string | null = token,
  ) =>
    fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(auth ? { authorization: `Bearer ${auth}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const commentPath = `/${POST_ID}/comments/${COMMENT_ID}`;

  it("requires authentication", async () => {
    expect((await send("PATCH", commentPath, { content: "x" }, null)).status).toBe(401);
    expect((await send("DELETE", commentPath, undefined, null)).status).toBe(401);
    expect(prismaMock.feedComment.findUnique).not.toHaveBeenCalled();
  });

  it("validates ids and content", async () => {
    expect((await send("PATCH", `/${POST_ID}/comments/nope`, { content: "x" })).status).toBe(422);
    expect((await send("PATCH", commentPath, { content: "   " })).status).toBe(422);
    expect((await send("PATCH", commentPath, {})).status).toBe(422);
    expect((await send("PATCH", commentPath, { content: "x".repeat(2001) })).status).toBe(422);
    expect(prismaMock.feedComment.update).not.toHaveBeenCalled();
  });

  it("trims and saves an edit, ignoring fields that cannot be changed", async () => {
    const response = await send("PATCH", commentPath, {
      content: "  Updated  ",
      authorId: "someone-else",
      postId: OTHER_POST_ID,
    });

    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({
      id: COMMENT_ID,
      content: "Updated",
      author: { id: "me" },
    });
    expect(prismaMock.feedComment.update.mock.calls[0][0].data).toEqual({ content: "Updated" });
  });

  it("returns 403 when editing or deleting someone else's comment", async () => {
    expect((await send("PATCH", commentPath, { content: "x" }, otherToken)).status).toBe(403);
    expect((await send("DELETE", commentPath, undefined, otherToken)).status).toBe(403);
    expect(prismaMock.feedComment.update).not.toHaveBeenCalled();
    expect(prismaMock.feedComment.delete).not.toHaveBeenCalled();
  });

  it("returns 404 for a missing comment", async () => {
    const missing = `/${POST_ID}/comments/${MISSING_ID}`;
    expect((await send("PATCH", missing, { content: "x" })).status).toBe(404);
    expect((await send("DELETE", missing)).status).toBe(404);
  });

  it("deletes and reports the remaining comment count", async () => {
    const response = await send("DELETE", commentPath);

    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({
      commentId: COMMENT_ID,
      commentCount: 0,
    });
  });
});
