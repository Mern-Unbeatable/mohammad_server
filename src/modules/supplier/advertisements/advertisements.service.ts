import { AdStatus, Prisma } from "@prisma/client";
import { prisma } from "@/infrastructure/prisma";
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from "@/shared/errors/AppError";
import { buildPaginationMeta } from "@/shared/http/apiResponse";
import { toPrismaPagination } from "@/shared/http/pagination";
import { serializeProfile } from "@/shared/serializers/user.serializer";
import type { AdListQuery } from "./advertisements.validators";

const include = {
  supplier: { include: { profile: true } },
} satisfies Prisma.AdvertisementInclude;
type Payload = Prisma.AdvertisementGetPayload<{ include: typeof include }>;

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
  durationDays: ad.durationDays,
  startDate: ad.startDate,
  expiryDate: ad.expiryDate,
  status: ad.status,
  rejectionReason: ad.rejectionReason,
  views: ad.views,
  clicks: ad.clicks,
  uploadDate: ad.createdAt,
  supplier: {
    id: ad.supplier.id,
    company: ad.supplier.profile?.company ?? null,
    ...(ad.supplier.profile ? serializeProfile(ad.supplier.profile) : {}),
  },
});

export const advertisementsService = {
  async list(userId: string, role: string, query: AdListQuery) {
    const { skip, take } = toPrismaPagination(query.page, query.pageSize);

    // Suppliers only ever see their own ads; admins see everything.
    const scope: Prisma.AdvertisementWhereInput =
      role === "ADMIN" ? {} : { supplierId: userId };

    const where: Prisma.AdvertisementWhereInput = {
      ...scope,
      ...(query.mine ? { supplierId: userId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.category ? { category: query.category } : {}),
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: "insensitive" } },
              { description: { contains: query.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const [rows, total] = await prisma.$transaction([
      prisma.advertisement.findMany({
        where,
        include,
        orderBy: { createdAt: query.sort },
        skip,
        take,
      }),
      prisma.advertisement.count({ where }),
    ]);

    return {
      data: rows.map(serialize),
      meta: buildPaginationMeta(query.page, query.pageSize, total),
    };
  },

  /** Publicly visible active ads for display on the site. */
  async listActive(query: AdListQuery) {
    const { skip, take } = toPrismaPagination(query.page, query.pageSize);
    const where: Prisma.AdvertisementWhereInput = {
      status: AdStatus.ACTIVE,
      ...(query.category ? { category: query.category } : {}),
    };
    const [rows, total] = await prisma.$transaction([
      prisma.advertisement.findMany({
        where,
        include,
        orderBy: { createdAt: query.sort },
        skip,
        take,
      }),
      prisma.advertisement.count({ where }),
    ]);
    return {
      data: rows.map(serialize),
      meta: buildPaginationMeta(query.page, query.pageSize, total),
    };
  },

  async getById(userId: string, role: string, id: string) {
    const ad = await prisma.advertisement.findUnique({
      where: { id },
      include,
    });
    if (!ad) throw new NotFoundError("Advertisement not found");
    if (
      role !== "ADMIN" &&
      ad.supplierId !== userId &&
      ad.status !== AdStatus.ACTIVE
    ) {
      throw new ForbiddenError("You cannot view this advertisement");
    }
    return serialize(ad);
  },

  async create(
    supplierId: string,
    input: {
      price?: number;
      durationDays: number;
      [key: string]: unknown;
    },
  ) {
    const { price, ...rest } = input;
    const ad = await prisma.advertisement.create({
      data: {
        ...(rest as Prisma.AdvertisementUncheckedCreateInput),
        supplierId,
        price: price === undefined ? null : Math.round(price * 100),
        status: AdStatus.PENDING,
      },
      include,
    });
    return serialize(ad);
  },

  async update(userId: string, id: string, input: Record<string, unknown>) {
    const ad = await prisma.advertisement.findUnique({ where: { id } });
    if (!ad) throw new NotFoundError("Advertisement not found");
    if (ad.supplierId !== userId)
      throw new ForbiddenError("You can only edit your own ads");

    const data: Prisma.AdvertisementUpdateInput = { ...input };
    if (typeof input.price === "number")
      data.price = Math.round(input.price * 100);
    // Editing a rejected ad resubmits it for review.
    if (ad.status === AdStatus.REJECTED) {
      data.status = AdStatus.PENDING;
      data.rejectionReason = null;
    }

    const updated = await prisma.advertisement.update({
      where: { id },
      data,
      include,
    });
    return serialize(updated);
  },

  async remove(userId: string, role: string, id: string) {
    const ad = await prisma.advertisement.findUnique({ where: { id } });
    if (!ad) throw new NotFoundError("Advertisement not found");
    if (ad.supplierId !== userId && role !== "ADMIN") {
      throw new ForbiddenError("You can only delete your own ads");
    }
    await prisma.advertisement.delete({ where: { id } });
  },

  /** Admin approval workflow: activate (sets live window), reject, or expire. */
  async review(id: string, status: AdStatus, rejectionReason?: string) {
    const ad = await prisma.advertisement.findUnique({ where: { id } });
    if (!ad) throw new NotFoundError("Advertisement not found");

    if (status === AdStatus.REJECTED && !rejectionReason) {
      throw new BadRequestError("A rejection reason is required");
    }

    const now = new Date();
    const data: Prisma.AdvertisementUpdateInput = { status };
    if (status === AdStatus.ACTIVE) {
      data.startDate = now;
      data.expiryDate = new Date(
        now.getTime() + ad.durationDays * 24 * 60 * 60 * 1000,
      );
      data.rejectionReason = null;
    }
    if (status === AdStatus.REJECTED) {
      data.rejectionReason = rejectionReason;
    }

    const updated = await prisma.advertisement.update({
      where: { id },
      data,
      include,
    });

    await prisma.notification.create({
      data: {
        userId: ad.supplierId,
        type:
          status === AdStatus.ACTIVE
            ? "AD_APPROVED"
            : status === AdStatus.REJECTED
              ? "AD_REJECTED"
              : "SYSTEM",
        title:
          status === AdStatus.ACTIVE
            ? "Advertisement approved"
            : status === AdStatus.REJECTED
              ? "Advertisement rejected"
              : "Advertisement updated",
        subtitle: status === AdStatus.REJECTED ? rejectionReason : ad.title,
        link: `/supplier/ads/${id}`,
      },
    });

    return serialize(updated);
  },

  /** Increments a lightweight engagement metric on an active ad. */
  async track(id: string, metric: "views" | "clicks") {
    await prisma.advertisement.updateMany({
      where: { id, status: AdStatus.ACTIVE },
      data: { [metric]: { increment: 1 } },
    });
  },
};
