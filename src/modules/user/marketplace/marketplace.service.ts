import { ListingStatus, Prisma } from "@prisma/client";
import { prisma } from "@/infrastructure/prisma";
import { ForbiddenError, NotFoundError, BadRequestError } from "@/shared/errors/AppError";
import { buildPaginationMeta } from "@/shared/http/apiResponse";
import { toPrismaPagination } from "@/shared/http/pagination";
import { serializeProfile } from "@/shared/serializers/user.serializer";
import type { ListingListQuery } from "./marketplace.validators";

const listingInclude = {
  seller: { include: { profile: true } },
  _count: { select: { savedBy: true } },
} satisfies Prisma.ListingInclude;

type ListingPayload = Prisma.ListingGetPayload<{
  include: typeof listingInclude;
}>;

/** Seller email/phone go only to the listing details page, never to the listing feed. */
const serializeListing = (
  listing: ListingPayload,
  savedIds?: Set<string>,
  { showContact = false }: { showContact?: boolean } = {},
) => ({
  id: listing.id,
  title: listing.title,
  description: listing.description,
  condition: listing.condition,
  category: listing.category,
  year: listing.year,
  price: listing.price / 100,
  location: listing.location,
  images: listing.images,
  image: listing.images[0] ?? null,
  status: listing.status,
  listedAt: listing.createdAt,
  savedCount: listing._count.savedBy,
  isSaved: savedIds ? savedIds.has(listing.id) : undefined,
  seller: {
    id: listing.seller.id,
    ...(listing.seller.profile ? serializeProfile(listing.seller.profile) : {}),
    phone: showContact ? (listing.seller.profile?.phone ?? null) : undefined,
    email: showContact ? listing.seller.email : undefined,
    contactVisible: showContact,
  },
});

export const marketplaceService = {
  async list(userId: string, query: ListingListQuery) {
    const { skip, take } = toPrismaPagination(query.page, query.pageSize);

    const where: Prisma.ListingWhereInput = {
      status: ListingStatus.ACTIVE,
      ...(query.category ? { category: query.category } : {}),
      ...(query.condition ? { condition: query.condition } : {}),
      ...(query.mine ? { sellerId: userId, status: undefined } : {}),
      ...(query.saved ? { savedBy: { some: { userId } } } : {}),
      ...(query.minPrice !== undefined || query.maxPrice !== undefined
        ? {
            price: {
              ...(query.minPrice !== undefined
                ? { gte: Math.round(query.minPrice * 100) }
                : {}),
              ...(query.maxPrice !== undefined
                ? { lte: Math.round(query.maxPrice * 100) }
                : {}),
            },
          }
        : {}),
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: "insensitive" } },
              { location: { contains: query.search, mode: "insensitive" } },
              {
                seller: {
                  profile: {
                    company: { contains: query.search, mode: "insensitive" },
                  },
                },
              },
            ],
          }
        : {}),
    };

    const [rows, total, saved] = await prisma.$transaction([
      prisma.listing.findMany({
        where,
        include: listingInclude,
        orderBy: { createdAt: query.sort },
        skip,
        take,
      }),
      prisma.listing.count({ where }),
      prisma.savedListing.findMany({
        where: { userId },
        select: { listingId: true },
      }),
    ]);

    const savedIds = new Set(saved.map((s) => s.listingId));
    return {
      data: rows.map((r) => serializeListing(r, savedIds)),
      meta: buildPaginationMeta(query.page, query.pageSize, total),
    };
  },

  async getById(userId: string, id: string) {
    const listing = await prisma.listing.findUnique({
      where: { id },
      include: listingInclude,
    });
    if (!listing) throw new NotFoundError("Listing not found");
    const saved = await prisma.savedListing.findUnique({
      where: { userId_listingId: { userId, listingId: id } },
    });
    return serializeListing(listing, new Set(saved ? [id] : []), { showContact: true });
  },

  async create(
    sellerId: string,
    input: {
      title: string;
      description: string;
      condition: ListingPayload["condition"];
      category: ListingPayload["category"];
      year?: number;
      price: number;
      location?: string;
      images: string[];
    },
  ) {
    const listing = await prisma.listing.create({
      data: { ...input, sellerId, price: Math.round(input.price * 100) },
      include: listingInclude,
    });
    return serializeListing(listing);
  },

  async update(
    userId: string,
    role: string,
    id: string,
    input: Record<string, unknown>,
  ) {
    const listing = await prisma.listing.findUnique({ where: { id } });
    if (!listing) throw new NotFoundError("Listing not found");
    if (listing.sellerId !== userId && role !== "ADMIN") {
      throw new ForbiddenError("You can only edit your own listings");
    }

    const data: Prisma.ListingUpdateInput = { ...input };
    if (typeof input.price === "number")
      data.price = Math.round(input.price * 100);

    const updated = await prisma.listing.update({
      where: { id },
      data,
      include: listingInclude,
    });
    return serializeListing(updated);
  },

  async remove(userId: string, role: string, id: string) {
    const listing = await prisma.listing.findUnique({ where: { id } });
    if (!listing) throw new NotFoundError("Listing not found");
    if (listing.sellerId !== userId && role !== "ADMIN") {
      throw new ForbiddenError("You can only delete your own listings");
    }
    await prisma.listing.delete({ where: { id } });
  },

  async toggleSave(userId: string, listingId: string) {
    const listing = await prisma.listing.findUnique({
      where: { id: listingId },
    });
    if (!listing) throw new NotFoundError("Listing not found");

    const existing = await prisma.savedListing.findUnique({
      where: { userId_listingId: { userId, listingId } },
    });

    if (existing) {
      await prisma.savedListing.delete({ where: { id: existing.id } });
      return { saved: false };
    }
    await prisma.savedListing.create({ data: { userId, listingId } });
    return { saved: true };
  },

  /** Notify the seller about a listing enquiry (uses LISTING_ENQUIRY). */
  async enquire(userId: string, listingId: string, message: string) {
    const listing = await prisma.listing.findUnique({
      where: { id: listingId },
      include: listingInclude,
    });
    if (!listing || listing.status !== ListingStatus.ACTIVE) {
      throw new NotFoundError("Listing not found");
    }
    if (listing.sellerId === userId) {
      throw new BadRequestError("You cannot enquire about your own listing");
    }

    await prisma.notification.create({
      data: {
        userId: listing.sellerId,
        type: "LISTING_ENQUIRY",
        title: "Listing enquiry",
        subtitle: message.slice(0, 200),
        link: `/marketplace/${listingId}`,
      },
    });

    return {
      listingId,
      sellerId: listing.sellerId,
      message: "Enquiry sent",
    };
  },
};
