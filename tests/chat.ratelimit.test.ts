import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";

const { messagesServiceMock } = vi.hoisted(() => ({
  messagesServiceMock: { sendMessage: vi.fn(async () => ({ id: "m1" })) },
}));

vi.mock("@/infrastructure/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn(async () => ({ status: "ACTIVE" })) },
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
  onNotificationsCreated: vi.fn(),
}));
vi.mock("@/modules/user/messages/messages.service", () => ({ messagesService: messagesServiceMock }));

import { startTestApp, tokenFor } from "./helpers/httpApp";

const CONVERSATION = "11111111-1111-4111-8111-111111111111";
let app: Awaited<ReturnType<typeof startTestApp>>;

beforeAll(async () => {
  app = await startTestApp();
});
afterAll(() => app.close());

const send = (userId: string) =>
  app.request("POST", `/messages/${CONVERSATION}/messages`, {
    token: tokenFor(userId, Role.USER),
    body: { body: "hello" },
  });

describe("per-account chat rate limits", () => {
  it("allows 30 messages a minute per account, then answers 429 RATE_LIMITED", async () => {
    const statuses = [];
    for (let i = 0; i < 30; i += 1) statuses.push((await send("spammer")).status);
    const blocked = await send("spammer");

    expect(statuses.every((status) => status === 201)).toBe(true);
    expect(blocked.status).toBe(429);
    expect((await blocked.json()).error.code).toBe("RATE_LIMITED");
    expect(messagesServiceMock.sendMessage).toHaveBeenCalledTimes(30);
  });

  it("keys the budget by account, not by IP", async () => {
    expect((await send("neighbour")).status).toBe(201);
  });

  it("limits uploads per account", async () => {
    const token = tokenFor("uploader", Role.SUPPLIER);
    const statuses = [];
    for (let i = 0; i < 41; i += 1) {
      statuses.push((await app.request("POST", "/uploads", { token, body: new FormData() })).status);
    }
    expect(statuses.slice(0, 40).every((status) => status === 400)).toBe(true);
    expect(statuses[40]).toBe(429);

    const chatUpload = await app.request("POST", "/messages/attachments", { token, body: new FormData() });
    expect(chatUpload.status).toBe(429);
  });
});
