import { AdStatus, Prisma } from "@prisma/client";
import { prisma } from "@/infrastructure/prisma";
import { buildPaginationMeta } from "@/shared/http/apiResponse";
import { toPrismaPagination } from "@/shared/http/pagination";
import type { FeedAdsQuery } from "./feed.validators";

const include = {
  supplier: { include: { profile: true } },
} satisfies Prisma.AdvertisementInclude;

type Payload = Prisma.AdvertisementGetPayload<{ include: typeof include }>;

/**
 * Serialize an advertisement for display in the user feed.
 * Includes supplier info, tracking metadata, and all necessary fields for CTAs.
 */
const serialize = (ad: Payload) => ({
  id: ad.id,
  title: ad.title,
  category: ad.category,
  description: ad.description,
  imageUrl: ad.imageUrl,
  videoUrl: ad.videoUrl,
  price: ad.price === null ? null : ad.price / 100,
  contact: ad.contact,
  location: ad.location,
  eventDate: ad.eventDate,
  eventTime: ad.eventTime,
  organizer: ad.organizer,
  startDate: ad.startDate,
  expiryDate: ad.expiryDate,
  views: ad.views,
  clicks: ad.clicks,
  supplier: {
    id: ad.supplier.id,
    company: ad.supplier.profile?.company ?? null,
    firstName: ad.supplier.profile?.firstName ?? null,
    lastName: ad.supplier.profile?.lastName ?? null,
    avatarUrl: ad.supplier.profile?.avatarUrl ?? null,
    initials: ad.supplier.profile?.initials ?? null,
  },
});

/**
 * Flip ACTIVE ads whose paid window has elapsed to EXPIRED. Called
 * opportunistically on reads so listings stay truthful without relying solely
 * on admin action.
 */
async function expireStaleAds() {
  try {
    await prisma.advertisement.updateMany({
      where: { status: AdStatus.ACTIVE, expiryDate: { lt: new Date() } },
      data: { status: AdStatus.EXPIRED },
    });
  } catch (err) {
    // Silent failure for expiration; non-critical for feed display
  }
}

/**
 * Check if an advertisement is eligible for display in the user feed.
 * All conditions must be met:
 * - Status is ACTIVE
 * - startDate has passed (or null)
 * - expiryDate has not passed (or null)
 * - Has valid display content (title, description, and at least one media)
 */
const isEligibleForFeed = (ad: Payload): boolean => {
  const now = new Date();

  // Must be ACTIVE
  if (ad.status !== AdStatus.ACTIVE) return false;

  // Start date must have passed (or be null)
  if (ad.startDate && ad.startDate > now) return false;

  // Expiry date must not have passed (or be null)
  if (ad.expiryDate && ad.expiryDate <= now) return false;

  // Must have valid display content
  if (!ad.title || !ad.description) return false;

  // Must have at least image or video
  if (!ad.imageUrl && !ad.videoUrl) return false;

  return true;
};

export const feedAdsService = {
  /**
   * Fetch eligible active advertisements for the user feed.
   * 
   * Rules:
   * - Only returns ACTIVE ads
   * - Filters by expiry date
   * - Excludes ads without valid content or media
   * - Supports pagination
   * - Returns supplier info needed for feed card display
   * - Does NOT return sensitive supplier data
   */
  async listForFeed(query: FeedAdsQuery) {
    await expireStaleAds();

    const { skip, take } = toPrismaPagination(query.page, query.pageSize);

    // Fetch ads that pass the basic database criteria
    const where: Prisma.AdvertisementWhereInput = {
      status: AdStatus.ACTIVE,
      // Database-level expiry check: catch any not yet swept
      OR: [{ expiryDate: null }, { expiryDate: { gt: new Date() } }],
      // Start date should have passed or be null
      AND: [
        {
          OR: [{ startDate: null }, { startDate: { lte: new Date() } }],
        },
      ],
    };

    const [rows] = await prisma.$transaction([
      prisma.advertisement.findMany({
        where,
        include,
        orderBy: { createdAt: "desc" },
        skip,
        take,
      }),
      prisma.advertisement.count({ where }),
    ]);

    // Additional filtering: ensure all ads meet feed eligibility criteria
    const eligibleAds = rows.filter(isEligibleForFeed);

    return {
      data: eligibleAds.map(serialize),
      meta: buildPaginationMeta(query.page, query.pageSize, eligibleAds.length),
    };
  },
};
