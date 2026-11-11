import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";
import { startTestApp, tokenFor } from "./helpers/httpApp";

const { prismaMock, payments } = vi.hoisted(() => ({
  prismaMock: {
    user: { findUnique: vi.fn(async () => ({ status: "ACTIVE" })) },
  },
  payments: {
    listMine: vi.fn(async () => ({ data: [], meta: { page: 1, pageSize: 10, total: 0 } })),
    listAll: vi.fn(async () => ({ data: [], meta: { page: 1, pageSize: 10, total: 0 } })),
    getLinks: vi.fn(async () => ({ invoicePdfUrl: "https://pay.stripe.com/x.pdf" })),
    syncAll: vi.fn(async () => ({ invoicesScanned: 0 })),
  },
}));

vi.mock("@/infrastructure/prisma", () => ({
  prisma: prismaMock,
  onNotificationsCreated: vi.fn(),
}));
vi.mock("@/modules/payments/payments.service", () => ({ paymentsService: payments }));

const PAYMENT = "33333333-3333-4333-8333-333333333333";
const user = tokenFor("user-1", Role.USER);
const supplier = tokenFor("supplier-1", Role.SUPPLIER);
const admin = tokenFor("admin-1", Role.ADMIN);

let app: Awaited<ReturnType<typeof startTestApp>>;
beforeAll(async () => {
  app = await startTestApp();
});
afterAll(() => app.close());
beforeEach(() => vi.clearAllMocks());

describe("member payment history", () => {
  it("requires sign-in", async () => {
    const response = await app.request("GET", "/payments/me");
    expect(response.status).toBe(401);
  });

  it.each([
    ["USER", user, "user-1"],
    ["SUPPLIER", supplier, "supplier-1"],
  ])("lists the signed-in %s account's own payments", async (_label, token, id) => {
    const response = await app.request("GET", "/payments/me?page=2&kind=advertisement", { token });
    expect(response.status).toBe(200);
    expect(payments.listMine).toHaveBeenCalledWith(
      id,
      expect.objectContaining({ page: 2, kind: "advertisement" }),
    );
  });

  it("passes the requester to the invoice-link lookup for the ownership check", async () => {
    const response = await app.request("GET", `/payments/${PAYMENT}/links`, { token: user });
    expect(response.status).toBe(200);
    expect(payments.getLinks).toHaveBeenCalledWith(
      PAYMENT,
      expect.objectContaining({ id: "user-1", role: Role.USER }),
    );
  });
});

describe("admin payments", () => {
  it("serves admins with filters", async () => {
    const response = await app.request("GET", "/admin/payments?status=paid&kind=subscription", {
      token: admin,
    });
    expect(response.status).toBe(200);
    expect(payments.listAll).toHaveBeenCalledWith(
      expect.objectContaining({ status: "paid", kind: "subscription" }),
    );
  });

  it.each([
    ["USER", user],
    ["SUPPLIER", supplier],
  ])("is closed to %s accounts", async (_label, token) => {
    const list = await app.request("GET", "/admin/payments", { token });
    const sync = await app.request("POST", "/admin/payments/sync", { token });
    expect([list.status, sync.status]).toEqual([403, 403]);
    expect(payments.listAll).not.toHaveBeenCalled();
    expect(payments.syncAll).not.toHaveBeenCalled();
  });

  it("rejects unknown filter values", async () => {
    const response = await app.request("GET", "/admin/payments?status=refunded", { token: admin });
    expect(response.status).toBe(422);
  });
});
