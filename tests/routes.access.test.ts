import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Role, UserStatus } from "@prisma/client";
import { startTestApp, tokenFor } from "./helpers/httpApp";

const { prismaMock, statuses, adminMessages, userMessages, adminUsers } = vi.hoisted(() => {
  const statuses = new Map<string, string>();
  return {
    statuses,
    prismaMock: {
      user: {
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
          statuses.has(where.id) ? { status: statuses.get(where.id) } : null,
        ),
      },
    },
    adminMessages: {
      listConversations: vi.fn(async () => ({ data: [], meta: {} })),
      getConversation: vi.fn(async () => ({})),
      getMessages: vi.fn(async () => ({ data: [], meta: {} })),
      deleteMessage: vi.fn(async () => ({})),
      deleteConversation: vi.fn(async () => ({})),
    },
    userMessages: {
      listConversations: vi.fn(async () => ({ data: [], meta: {} })),
      sendMessage: vi.fn(async () => ({ id: "m1" })),
    },
    adminUsers: { updateStatus: vi.fn(async () => ({})) },
  };
});

vi.mock("@/infrastructure/prisma", () => ({
  prisma: prismaMock,
  onNotificationsCreated: vi.fn(),
}));
vi.mock("@/modules/admin/messages/messages.service", () => ({
  adminMessagesService: adminMessages,
}));
vi.mock("@/modules/user/messages/messages.service", () => ({
  messagesService: userMessages,
}));
vi.mock("@/modules/admin/users/users.service", () => ({ usersService: adminUsers }));

const CONVERSATION = "11111111-1111-4111-8111-111111111111";
const MESSAGE = "22222222-2222-4222-8222-222222222222";

const accounts = {
  admin: { id: "admin-active", role: Role.ADMIN, status: UserStatus.ACTIVE },
  suspendedAdmin: { id: "admin-suspended", role: Role.ADMIN, status: UserStatus.SUSPENDED },
  bannedAdmin: { id: "admin-banned", role: Role.ADMIN, status: UserStatus.BANNED },
  user: { id: "user-active", role: Role.USER, status: UserStatus.ACTIVE },
  suspendedUser: { id: "user-suspended", role: Role.USER, status: UserStatus.SUSPENDED },
  supplier: { id: "supplier-active", role: Role.SUPPLIER, status: UserStatus.ACTIVE },
  bannedSupplier: { id: "supplier-banned", role: Role.SUPPLIER, status: UserStatus.BANNED },
};
const token = (account: (typeof accounts)[keyof typeof accounts]) =>
  tokenFor(account.id, account.role);

let app: Awaited<ReturnType<typeof startTestApp>>;

beforeAll(async () => {
  app = await startTestApp();
});
afterAll(() => app.close());

beforeEach(() => {
  vi.clearAllMocks();
  statuses.clear();
  Object.values(accounts).forEach((account) => statuses.set(account.id, account.status));
});

describe("admin moderation endpoints", () => {
  it("stay available to active admins", async () => {
    const list = await app.request("GET", "/admin/messages", { token: token(accounts.admin) });
    const remove = await app.request(
      "DELETE",
      `/admin/messages/${CONVERSATION}/messages/${MESSAGE}`,
      { token: token(accounts.admin) },
    );
    expect(list.status).toBe(200);
    expect(remove.status).toBe(200);
    expect(adminMessages.deleteMessage).toHaveBeenCalledWith(CONVERSATION, MESSAGE, accounts.admin.id);
  });

  it("attributes conversation deletions to the acting admin", async () => {
    const response = await app.request("DELETE", `/admin/messages/${CONVERSATION}`, {
      token: token(accounts.admin),
    });
    expect(response.status).toBe(200);
    expect(adminMessages.deleteConversation).toHaveBeenCalledWith(CONVERSATION, accounts.admin.id);
  });

  it.each([
    ["suspended", accounts.suspendedAdmin],
    ["banned", accounts.bannedAdmin],
  ])("are refused to %s admins with a still-valid access token", async (_label, account) => {
    const list = await app.request("GET", "/admin/messages", { token: token(account) });
    const thread = await app.request("GET", `/admin/messages/${CONVERSATION}/messages`, {
      token: token(account),
    });
    const remove = await app.request("DELETE", `/admin/messages/${CONVERSATION}`, {
      token: token(account),
    });
    expect([list.status, thread.status, remove.status]).toEqual([403, 403, 403]);
    expect(adminMessages.listConversations).not.toHaveBeenCalled();
    expect(adminMessages.getMessages).not.toHaveBeenCalled();
    expect(adminMessages.deleteConversation).not.toHaveBeenCalled();
  });

  it.each([
    ["USER", accounts.user],
    ["SUPPLIER", accounts.supplier],
  ])("stay closed to active %s accounts", async (_label, account) => {
    const response = await app.request("GET", "/admin/messages", { token: token(account) });
    expect(response.status).toBe(403);
    expect(adminMessages.listConversations).not.toHaveBeenCalled();
  });
});

describe("admin user management", () => {
  it("does not let a suspended admin change account status (e.g. reactivate themselves)", async () => {
    const response = await app.request("PATCH", `/users/${accounts.suspendedAdmin.id}/status`, {
      token: token(accounts.suspendedAdmin),
      body: { status: "ACTIVE" },
    });
    expect(response.status).toBe(403);
    expect(adminUsers.updateStatus).not.toHaveBeenCalled();
  });
});

describe("regular chat endpoints", () => {
  it.each([
    ["USER", accounts.user],
    ["SUPPLIER", accounts.supplier],
    ["ADMIN", accounts.admin],
  ])("still serve active %s accounts", async (_label, account) => {
    const response = await app.request("GET", "/messages", { token: token(account) });
    expect(response.status).toBe(200);
  });

  it.each([
    ["suspended USER", accounts.suspendedUser],
    ["banned SUPPLIER", accounts.bannedSupplier],
  ])("refuse %s accounts", async (_label, account) => {
    const response = await app.request("POST", `/messages/${CONVERSATION}/messages`, {
      token: token(account),
      body: { body: "hello" },
    });
    expect(response.status).toBe(403);
    expect(userMessages.sendMessage).not.toHaveBeenCalled();
  });
});

describe("uploads", () => {
  it.each([
    ["suspended USER", accounts.suspendedUser],
    ["banned SUPPLIER", accounts.bannedSupplier],
    ["suspended ADMIN", accounts.suspendedAdmin],
  ])("refuse new attachments from %s accounts", async (_label, account) => {
    const form = new FormData();
    form.append("file", new Blob([Buffer.from("%PDF-1.4\n")], { type: "application/pdf" }), "a.pdf");
    const response = await app.request("POST", "/uploads", { token: token(account), body: form });
    expect(response.status).toBe(403);
  });

  it("requires authentication", async () => {
    const response = await app.request("POST", "/uploads", { body: new FormData() });
    expect(response.status).toBe(401);
  });
});
