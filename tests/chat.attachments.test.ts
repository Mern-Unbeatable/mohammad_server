import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";
import { fixtures } from "./helpers/fileFixtures";

const { workDir, originalCwd, prismaMock, emitToUsers } = vi.hoisted(() => {
  const fsSync = require("node:fs") as typeof import("node:fs");
  const os = require("node:os") as typeof import("node:os");
  const pathMod = require("node:path") as typeof import("node:path");
  const originalCwd = process.cwd();
  const workDir = fsSync.mkdtempSync(pathMod.join(os.tmpdir(), "lu-chat-files-"));
  process.chdir(workDir);
  return {
    workDir,
    originalCwd,
    emitToUsers: vi.fn(),
    prismaMock: {
      user: { findUnique: vi.fn() },
      subscription: { findUnique: vi.fn() },
      message: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
        delete: vi.fn(),
      },
      conversation: { deleteMany: vi.fn(), findUnique: vi.fn() },
      conversationParticipant: { findMany: vi.fn() },
      moderationLog: { create: vi.fn() },
      $transaction: vi.fn((queries: Promise<unknown>[]) => Promise.all(queries)),
    },
  };
});

vi.mock("@/infrastructure/prisma", () => ({ prisma: prismaMock, onNotificationsCreated: vi.fn() }));
vi.mock("@/realtime/socket", () => ({ emitToUsers }));

import { startTestApp, tokenFor } from "./helpers/httpApp";
import {
  attachmentPath,
  presentAttachments,
  removeUnreferencedAttachments,
  resolveOutgoingAttachments,
  signAttachmentUrl,
} from "@/shared/chat/attachments";
import { serializeMessage } from "@/modules/user/messages/messages.helpers";
import { adminMessagesService } from "@/modules/admin/messages/messages.service";

const CONVERSATION = "11111111-1111-4111-8111-111111111111";
const OTHER_CONVERSATION = "33333333-3333-4333-8333-333333333333";
const ALICE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BOB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

let app: Awaited<ReturnType<typeof startTestApp>>;
let origin: string;

beforeAll(async () => {
  app = await startTestApp();
  origin = (await app.request("GET", "/__probe__")).url.replace(/\/api\/v1.*$/, "");
});
afterAll(async () => {
  await app.close();
  process.chdir(originalCwd);
});

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.user.findUnique.mockResolvedValue({ status: "ACTIVE" });
  prismaMock.subscription.findUnique.mockResolvedValue({
    status: "TRIAL",
    plan: "FREE",
    trialDaysTotal: 90,
    startDate: new Date(),
    createdAt: new Date(),
    renewalDate: null,
    stripeSubscriptionId: null,
  });
  prismaMock.message.count.mockResolvedValue(0);
  prismaMock.message.findMany.mockResolvedValue([]);
  prismaMock.conversationParticipant.findMany.mockResolvedValue([]);
});

const uploadAs = async (userId: string, bytes: Buffer, name: string, type: string) => {
  const body = new FormData();
  body.append("file", new Blob([bytes], { type }), name);
  const response = await app.request("POST", "/messages/attachments", {
    token: tokenFor(userId, Role.USER),
    body,
  });
  return { status: response.status, data: (await response.json()).data };
};

/** Points the "is this file still attached here?" lookup at `attachments`. */
const attachedIn = (conversationId: string, attachments: unknown[]) =>
  prismaMock.message.findFirst.mockImplementation(async ({ where }) =>
    where.conversationId === conversationId ? { attachments } : null,
  );

const pathOf = (url: string) => url.replace("http://localhost:4000", "");

describe("POST /messages/attachments", () => {
  it("stores the file privately under the uploader and returns a key, not a URL", async () => {
    const { status, data } = await uploadAs(ALICE, fixtures.pdf(), "Q3 report.pdf", "application/pdf");

    expect(status).toBe(201);
    expect(data).toEqual({
      key: expect.stringMatching(new RegExp(`^${ALICE}/\\d+-[0-9a-f]{16}\\.pdf$`)),
      name: "Q3 report.pdf",
      mimeType: "application/pdf",
      size: fixtures.pdf().length,
    });
    expect(data.url).toBeUndefined();
    expect(fs.existsSync(path.join(workDir, "private-uploads", "chat", ...data.key.split("/")))).toBe(true);
  });

  it("applies the same content validation as public uploads", async () => {
    const { status } = await uploadAs(ALICE, fixtures.html(), "page.pdf", "application/pdf");
    expect(status).toBe(400);
  });

  it("is not reachable through the public /uploads static folder", async () => {
    const { data } = await uploadAs(ALICE, fixtures.png(), "a.png", "image/png");
    const viaStatic = await fetch(`${origin}/uploads/../private-uploads/chat/${data.key}`);
    const viaStaticDirect = await fetch(`${origin}/uploads/chat/${data.key}`);

    expect(viaStatic.status).toBe(404);
    expect(viaStaticDirect.status).toBe(404);
  });

  it("requires an active, signed-in user", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ status: "SUSPENDED" });
    const suspended = await uploadAs(ALICE, fixtures.png(), "a.png", "image/png");
    const anonymous = await app.request("POST", "/messages/attachments", { body: new FormData() });

    expect(suspended.status).toBe(403);
    expect(anonymous.status).toBe(401);
  });
});

describe("GET /chat-attachments (signed links)", () => {
  let key: string;

  beforeAll(async () => {
    prismaMock.user.findUnique.mockResolvedValue({ status: "ACTIVE" });
    prismaMock.subscription.findUnique.mockResolvedValue({
      status: "TRIAL",
      plan: "FREE",
      trialDaysTotal: 90,
      startDate: new Date(),
      createdAt: new Date(),
      renewalDate: null,
      stripeSubscriptionId: null,
    });
    key = (await uploadAs(ALICE, fixtures.png(), "diagram.png", "image/png")).data.key;
  });

  it("serves the file to a valid link while it is still attached in that conversation", async () => {
    attachedIn(CONVERSATION, [{ key, name: "diagram.png", mimeType: "image/png", size: 64 }]);
    const response = await fetch(`${origin}${pathOf(signAttachmentUrl(CONVERSATION, key))}`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toContain("sandbox");
    expect(response.headers.get("content-disposition")).toContain('inline; filename="diagram.png"');
    expect(response.headers.get("cache-control")).toMatch(/^private, max-age=\d+$/);
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("refuses links with a tampered signature or no signature", async () => {
    attachedIn(CONVERSATION, [{ key, name: "diagram.png", mimeType: "image/png", size: 64 }]);
    const url = new URL(signAttachmentUrl(CONVERSATION, key));
    url.searchParams.set("sig", `${url.searchParams.get("sig")!.slice(0, -2)}AA`);

    const tampered = await fetch(`${origin}${url.pathname}${url.search}`);
    const unsigned = await fetch(`${origin}${url.pathname}`);

    expect(tampered.status).toBe(403);
    expect(unsigned.status).toBe(403);
  });

  it("refuses expired links", async () => {
    attachedIn(CONVERSATION, [{ key, name: "diagram.png", mimeType: "image/png", size: 64 }]);
    const issuedLongAgo = Date.now() - 3 * 24 * 3600 * 1000;
    const response = await fetch(`${origin}${pathOf(signAttachmentUrl(CONVERSATION, key, issuedLongAgo))}`);
    expect(response.status).toBe(403);
  });

  it("does not let a link for one conversation open another conversation's path", async () => {
    attachedIn(OTHER_CONVERSATION, [{ key, name: "diagram.png", mimeType: "image/png", size: 64 }]);
    const signed = new URL(signAttachmentUrl(CONVERSATION, key));
    const swapped = signed.pathname.replace(CONVERSATION, OTHER_CONVERSATION);

    const response = await fetch(`${origin}${swapped}${signed.search}`);
    expect(response.status).toBe(403);
  });

  it("stops serving once no message in the conversation carries the file", async () => {
    attachedIn(CONVERSATION, []);
    prismaMock.message.findFirst.mockResolvedValue(null);
    const response = await fetch(`${origin}${pathOf(signAttachmentUrl(CONVERSATION, key))}`);
    expect(response.status).toBe(404);
  });

  it("serves documents as downloads under their original name", async () => {
    const pdfKey = (await uploadAs(ALICE, fixtures.pdf(), "a.pdf", "application/pdf")).data.key;
    attachedIn(CONVERSATION, [{ key: pdfKey, name: "Budget 2026.pdf", mimeType: "application/pdf", size: 1 }]);

    const response = await fetch(`${origin}${pathOf(signAttachmentUrl(CONVERSATION, pdfKey))}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toMatch(/^attachment; filename="Budget 2026.pdf"/);
  });

  it("rejects malformed keys before touching the filesystem", async () => {
    const response = await fetch(`${origin}/chat-attachments/${CONVERSATION}/..%2F..%2F/etc?exp=9999999999&sig=x`);
    expect([403, 404]).toContain(response.status);
    expect(prismaMock.message.findFirst).not.toHaveBeenCalled();
  });
});

describe("attachment presentation", () => {
  it("turns stored keys into signed links and passes legacy URLs through", () => {
    const key = `${ALICE}/1792294372789-120b0db25f164c60.png`;
    const legacy = "http://localhost:4000/uploads/1792294372789-120b0db25f164c60.webp";
    const presented = presentAttachments(CONVERSATION, [
      { key, name: "a.png", mimeType: "image/png", size: 10 },
      { url: legacy, name: "b.webp", mimeType: "image/webp", size: 20 },
    ]);

    expect(presented[0]).toEqual({
      url: expect.stringMatching(
        new RegExp(`^http://localhost:4000/chat-attachments/${CONVERSATION}/${key}\\?exp=\\d+&sig=[\\w-]+$`),
      ),
      name: "a.png",
      mimeType: "image/png",
      size: 10,
    });
    expect(presented[0]).not.toHaveProperty("key");
    expect(presented[1]).toEqual({ url: legacy, name: "b.webp", mimeType: "image/webp", size: 20 });
  });

  it("keeps links stable within a TTL bucket so cached threads do not churn", () => {
    const key = `${ALICE}/1792294372789-120b0db25f164c60.png`;
    const now = Date.UTC(2026, 9, 20, 10, 0, 0);
    expect(signAttachmentUrl(CONVERSATION, key, now)).toBe(signAttachmentUrl(CONVERSATION, key, now + 1000));
  });

  it("is what serializeMessage returns for both members and moderators", () => {
    const key = `${ALICE}/1792294372789-120b0db25f164c60.pdf`;
    const serialized = serializeMessage(
      {
        id: "m1",
        conversationId: CONVERSATION,
        senderId: ALICE,
        body: "",
        attachments: [{ key, name: "a.pdf", mimeType: "application/pdf", size: 3 }],
        listingId: null,
        listing: null,
        type: "TEXT",
        event: null,
        createdAt: new Date(),
        editedAt: null,
        sender: { id: ALICE, email: "a@x.test", profile: null },
      } as never,
      BOB,
    );
    expect(serialized.attachments[0].url).toContain(`/chat-attachments/${CONVERSATION}/${key}?`);
  });
});

describe("resolveOutgoingAttachments", () => {
  it("takes type and size from the stored file and ignores client claims", async () => {
    const { data } = await uploadAs(ALICE, fixtures.jpeg(), "x.jpg", "image/jpeg");
    const [stored] = await resolveOutgoingAttachments(ALICE, [{ key: data.key, name: "../Holiday.jpg" }]);

    expect(stored).toEqual({
      key: data.key,
      name: "Holiday.jpg",
      mimeType: "image/jpeg",
      size: fixtures.jpeg().length,
    });
  });

  it("refuses to attach someone else's upload", async () => {
    const { data } = await uploadAs(ALICE, fixtures.png(), "a.png", "image/png");
    await expect(resolveOutgoingAttachments(BOB, [{ key: data.key, name: "a.png" }])).rejects.toMatchObject({
      statusCode: 400,
      message: "Attachments must be your own uploads",
    });
  });

  it("refuses keys whose file does not exist", async () => {
    const key = `${ALICE}/1792294372789-0000000000000000.png`;
    await expect(resolveOutgoingAttachments(ALICE, [{ key, name: "a.png" }])).rejects.toMatchObject({
      message: "Attachment not found",
    });
  });

  it("still accepts legacy public-upload URLs from older clients, with server-derived metadata", async () => {
    const uploads = path.join(workDir, "uploads");
    fs.mkdirSync(uploads, { recursive: true });
    fs.writeFileSync(path.join(uploads, "1792294372789-120b0db25f164c60.webp"), fixtures.webp());
    const url = "http://localhost:4000/uploads/1792294372789-120b0db25f164c60.webp";

    const [stored] = await resolveOutgoingAttachments(ALICE, [{ url, name: "pic.webp" }]);
    expect(stored).toEqual({ url, name: "pic.webp", mimeType: "image/webp", size: fixtures.webp().length });

    await expect(
      resolveOutgoingAttachments(ALICE, [{ url: "http://localhost:4000/uploads/missing.png", name: "x" }]),
    ).rejects.toMatchObject({ message: "Attachment not found" });
    await expect(
      resolveOutgoingAttachments(ALICE, [{ url: "http://localhost:4000/uploads/page.html", name: "x" }]),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe("attachment cleanup", () => {
  it("deletes a file once no message references it, and keeps shared ones", async () => {
    const lonely = (await uploadAs(ALICE, fixtures.png(), "a.png", "image/png")).data.key;
    const shared = (await uploadAs(ALICE, fixtures.png(), "b.png", "image/png")).data.key;
    prismaMock.message.count.mockImplementation(async ({ where }) =>
      where.attachments.array_contains[0].key === shared ? 1 : 0,
    );

    await removeUnreferencedAttachments([lonely, shared, lonely]);

    expect(fs.existsSync(attachmentPath(lonely))).toBe(false);
    expect(fs.existsSync(attachmentPath(shared))).toBe(true);
    expect(prismaMock.message.count).toHaveBeenCalledTimes(2);
  });

  it("tolerates files that are already gone", async () => {
    await expect(
      removeUnreferencedAttachments([`${ALICE}/1792294372789-ffffffffffffffff.png`]),
    ).resolves.toBeUndefined();
  });

  it("removes a moderated message's files after the row is deleted", async () => {
    const key = (await uploadAs(ALICE, fixtures.pdf(), "a.pdf", "application/pdf")).data.key;
    prismaMock.message.findFirst.mockResolvedValue({
      id: "m1",
      attachments: [{ key, name: "a.pdf", mimeType: "application/pdf", size: 1 }],
    });
    const order: string[] = [];
    prismaMock.message.delete.mockImplementation(async () => order.push("delete-row"));
    prismaMock.message.count.mockImplementation(async () => {
      order.push("count-references");
      return 0;
    });

    await adminMessagesService.deleteMessage(CONVERSATION, "m1", "admin-1");

    expect(order).toEqual(["delete-row", "count-references"]);
    expect(fs.existsSync(attachmentPath(key))).toBe(false);
  });

  it("collects a conversation's files before deleting it, then removes them", async () => {
    const key = (await uploadAs(ALICE, fixtures.png(), "a.png", "image/png")).data.key;
    prismaMock.message.findMany.mockResolvedValue([
      { attachments: [{ key, name: "a.png", mimeType: "image/png", size: 1 }] },
      { attachments: [{ url: "http://localhost:4000/uploads/legacy.png", name: "l", mimeType: "image/png", size: 1 }] },
    ]);
    prismaMock.conversation.deleteMany.mockResolvedValue({ count: 1 });
    prismaMock.conversation.findUnique.mockResolvedValue({ id: CONVERSATION, _count: { messages: 2 } });

    await adminMessagesService.deleteConversation(CONVERSATION, "admin-1");

    expect(prismaMock.message.findMany.mock.invocationCallOrder[0]).toBeLessThan(
      prismaMock.conversation.deleteMany.mock.invocationCallOrder[0],
    );
    expect(fs.existsSync(attachmentPath(key))).toBe(false);
  });
});
