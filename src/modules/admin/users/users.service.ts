import {
  JobApplicationStatus,
  Prisma,
  Role,
  UserStatus,
} from "@prisma/client";
import { prisma } from "@/infrastructure/prisma";
import { disconnectUser } from "@/realtime/socket";
import { NotFoundError } from "@/shared/errors/AppError";
import {
  serializeProfile,
  serializeUser,
  userWithRelations,
} from "@/shared/serializers/user.serializer";
import { buildPaginationMeta } from "@/shared/http/apiResponse";
import { toPrismaPagination } from "@/shared/http/pagination";
import type { AdminUserListQuery } from "./users.validators";

const ROLE_MAP: Record<string, Role> = {
  user: Role.USER,
  supplier: Role.SUPPLIER,
  admin: Role.ADMIN,
};

const STATUS_MAP: Record<string, UserStatus> = {
  active: UserStatus.ACTIVE,
  suspended: UserStatus.SUSPENDED,
  banned: UserStatus.BANNED,
};

export const usersService = {
  async listUsers(query: AdminUserListQuery) {
    const { skip, take } = toPrismaPagination(query.page, query.pageSize);

    const where: Prisma.UserWhereInput = {
      ...(query.role ? { role: ROLE_MAP[query.role] } : {}),
      ...(query.status ? { status: STATUS_MAP[query.status] } : {}),
      ...(query.plan
        ? { subscription: { plan: query.plan.toUpperCase() as never } }
        : {}),
      ...(query.search
        ? {
            OR: [
              { email: { contains: query.search, mode: "insensitive" } },
              {
                profile: {
                  company: { contains: query.search, mode: "insensitive" },
                },
              },
              {
                profile: {
                  firstName: { contains: query.search, mode: "insensitive" },
                },
              },
              {
                profile: {
                  lastName: { contains: query.search, mode: "insensitive" },
                },
              },
            ],
          }
        : {}),
    };

    const [rows, total] = await prisma.$transaction([
      prisma.user.findMany({
        where,
        include: userWithRelations,
        orderBy: { createdAt: query.sort },
        skip,
        take,
      }),
      prisma.user.count({ where }),
    ]);

    return {
      data: rows.map(serializeUser),
      meta: buildPaginationMeta(query.page, query.pageSize, total),
    };
  },

  async getUserById(id: string, viewerRole?: string) {
    const user = await prisma.user.findUnique({
      where: { id },
      include: userWithRelations,
    });
    if (!user) throw new NotFoundError("User not found");

    // Non-admins may only view ACTIVE members (public profile).
    if (viewerRole !== "ADMIN") {
      if (user.status !== UserStatus.ACTIVE) {
        throw new NotFoundError("User not found");
      }
      return {
        id: user.id,
        role: user.role,
        profileType: user.profileType,
        profile: user.profile ? serializeProfile(user.profile) : null,
      };
    }

    return serializeUser(user);
  },

  async updateStatus(
    id: string,
    status: UserStatus,
    actorId: string,
    reason?: string,
  ) {
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundError("User not found");

    const deactivating =
      status === UserStatus.SUSPENDED || status === UserStatus.BANNED;

    const updated = await prisma.user.update({
      where: { id },
      data: {
        status,
        ...(deactivating ? { warnings: { increment: 0 } } : {}),
      },
      include: userWithRelations,
    });

    if (deactivating) {
      // End existing sessions: no further refreshes, no live chat events.
      await prisma.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      disconnectUser(id);
    }

    await prisma.moderationLog.create({
      data: {
        actorId,
        targetUserId: id,
        action:
          status === UserStatus.BANNED
            ? "BAN"
            : status === UserStatus.SUSPENDED
              ? "SUSPEND"
              : "DISMISS",
        note: reason || null,
      },
    });

    return serializeUser(updated);
  },

  /** Latest ads, marketplace listings and job posts owned by a user, with totals. */
  async getUserContent(id: string, take = 6) {
    const user = await prisma.user.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!user) throw new NotFoundError("User not found");

    const newest = { orderBy: { createdAt: "desc" as const }, take };
    const [ads, adsTotal, listings, listingsTotal, jobs, jobsTotal] =
      await prisma.$transaction([
        prisma.advertisement.findMany({ where: { supplierId: id }, ...newest }),
        prisma.advertisement.count({ where: { supplierId: id } }),
        prisma.listing.findMany({ where: { sellerId: id }, ...newest }),
        prisma.listing.count({ where: { sellerId: id } }),
        prisma.job.findMany({
          where: { ownerId: id },
          include: {
            _count: {
              select: {
                applications: {
                  where: { status: { not: JobApplicationStatus.CANCELLED } },
                },
              },
            },
          },
          ...newest,
        }),
        prisma.job.count({ where: { ownerId: id } }),
      ]);

    return {
      advertisements: {
        total: adsTotal,
        items: ads.map((ad) => ({
          id: ad.id,
          title: ad.title,
          category: ad.category,
          status: ad.status,
          imageUrl: ad.imageUrl,
          views: ad.views,
          clicks: ad.clicks,
          startDate: ad.startDate,
          expiryDate: ad.expiryDate,
          createdAt: ad.createdAt,
        })),
      },
      listings: {
        total: listingsTotal,
        items: listings.map((listing) => ({
          id: listing.id,
          title: listing.title,
          category: listing.category,
          status: listing.status,
          price: listing.price / 100,
          imageUrl: listing.images[0] ?? null,
          createdAt: listing.createdAt,
        })),
      },
      jobs: {
        total: jobsTotal,
        items: jobs.map((job) => ({
          id: job.id,
          title: job.title,
          company: job.company,
          status: job.status,
          imageUrl: job.imageUrl,
          applicationsCount: job._count.applications,
          createdAt: job.createdAt,
        })),
      },
    };
  },
};
