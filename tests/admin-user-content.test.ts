import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findUnique: vi.fn() },
    advertisement: { findMany: vi.fn(), count: vi.fn() },
    listing: { findMany: vi.fn(), count: vi.fn() },
    job: { findMany: vi.fn(), count: vi.fn() },
    $transaction: vi.fn((queries: Promise<unknown>[]) => Promise.all(queries)),
  },
}));

vi.mock("@/infrastructure/prisma", () => ({ prisma: prismaMock }));

import { usersService } from "@/modules/admin/users/users.service";

const created = new Date("2026-10-01T00:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.$transaction.mockImplementation((queries: Promise<unknown>[]) =>
    Promise.all(queries),
  );
});

describe("usersService.getUserContent", () => {
  it("returns the user's ads, listings and jobs with totals", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: "s1" });
    prismaMock.advertisement.findMany.mockResolvedValue([
      {
        id: "ad1",
        title: "Centrifuge promo",
        category: "PRODUCT",
        status: "ACTIVE",
        imageUrl: null,
        views: 12,
        clicks: 3,
        startDate: created,
        expiryDate: null,
        createdAt: created,
      },
    ]);
    prismaMock.advertisement.count.mockResolvedValue(9);
    prismaMock.listing.findMany.mockResolvedValue([
      {
        id: "l1",
        title: "Incubator",
        category: "EQUIPMENT",
        status: "ACTIVE",
        price: 50100,
        images: ["https://img/1.jpg", "https://img/2.jpg"],
        createdAt: created,
      },
    ]);
    prismaMock.listing.count.mockResolvedValue(1);
    prismaMock.job.findMany.mockResolvedValue([
      {
        id: "j1",
        title: "Technician",
        company: "Lab",
        status: "OPEN",
        imageUrl: null,
        createdAt: created,
        _count: { applications: 4 },
      },
    ]);
    prismaMock.job.count.mockResolvedValue(2);

    const content = await usersService.getUserContent("s1");

    expect(prismaMock.advertisement.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { supplierId: "s1" }, take: 6 }),
    );
    expect(prismaMock.listing.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { sellerId: "s1" } }),
    );
    expect(prismaMock.job.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { ownerId: "s1" } }),
    );
    expect(content.advertisements.total).toBe(9);
    expect(content.advertisements.items[0]).toMatchObject({ id: "ad1", views: 12 });
    expect(content.listings.items[0]).toMatchObject({
      price: 501,
      imageUrl: "https://img/1.jpg",
    });
    expect(content.jobs).toEqual({
      total: 2,
      items: [expect.objectContaining({ id: "j1", applicationsCount: 4 })],
    });
  });

  it("fails for an unknown user", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    await expect(usersService.getUserContent("missing")).rejects.toThrow(
      /not found/i,
    );
  });
});
