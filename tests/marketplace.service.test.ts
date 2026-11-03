import { beforeEach, describe, expect, it, vi } from "vitest";
import { ListingStatus } from "@prisma/client";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    listing: { findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn(), create: vi.fn() },
    savedListing: { findUnique: vi.fn(), findMany: vi.fn() },
    connection: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/infrastructure/prisma", () => ({ prisma: prismaMock }));

import { marketplaceService } from "@/modules/user/marketplace/marketplace.service";

const SELLER = "seller";
const VIEWER = "viewer-not-connected";

const listingRow = () => ({
  id: "l1",
  title: "Benchtop Centrifuge",
  description: "Works",
  condition: "GOOD",
  category: "CENTRIFUGATION",
  year: 2021,
  price: 50000,
  location: "Lyon",
  images: [],
  status: ListingStatus.ACTIVE,
  createdAt: new Date(),
  sellerId: SELLER,
  _count: { savedBy: 0 },
  seller: {
    id: SELLER,
    email: "ana@lab.io",
    profile: {
      firstName: "Ana",
      lastName: "Lab",
      title: null,
      company: null,
      country: null,
      location: null,
      phone: "+33 612345678",
      about: null,
      aboutExtended: null,
      avatarUrl: null,
      coverUrl: null,
      initials: null,
      connectionsCount: 0,
    },
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.listing.findUnique.mockResolvedValue(listingRow());
  prismaMock.savedListing.findUnique.mockResolvedValue(null);
});

describe("marketplaceService.getById seller contact details", () => {
  it("shares the seller's email and phone with any member, connected or not", async () => {
    const listing = await marketplaceService.getById(VIEWER, "l1");

    expect(listing.seller).toMatchObject({
      email: "ana@lab.io",
      phone: "+33 612345678",
      contactVisible: true,
    });
    expect(prismaMock.connection.findFirst).not.toHaveBeenCalled();
  });

  it("returns a null phone when the seller has none on their profile", async () => {
    const row = listingRow();
    row.seller.profile.phone = null as unknown as string;
    prismaMock.listing.findUnique.mockResolvedValue(row);

    const listing = await marketplaceService.getById(VIEWER, "l1");

    expect(listing.seller.phone).toBeNull();
    expect(listing.seller.email).toBe("ana@lab.io");
  });
});

describe("marketplaceService.create category", () => {
  it("stores and returns the OTHER category", async () => {
    prismaMock.listing.create.mockResolvedValue({ ...listingRow(), category: "OTHER" });

    const listing = await marketplaceService.create(SELLER, {
      title: "Glassware lot",
      description: "Assorted beakers",
      condition: "GOOD",
      category: "OTHER",
      price: 120,
      images: [],
    });

    expect(prismaMock.listing.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ category: "OTHER", price: 12000, sellerId: SELLER }),
      }),
    );
    expect(listing.category).toBe("OTHER");
  });
});

describe("marketplaceService.list seller contact details", () => {
  it("never includes seller email or phone in the listing feed", async () => {
    prismaMock.$transaction.mockResolvedValue([[listingRow()], 1, []]);

    const { data } = await marketplaceService.list(VIEWER, {
      page: 1,
      pageSize: 20,
      sort: "desc",
    } as never);

    expect(data[0].seller.email).toBeUndefined();
    expect(data[0].seller.phone).toBeUndefined();
    expect(JSON.stringify(data)).not.toContain("612345678");
  });
});
