import { Prisma, Role, UserStatus } from "@prisma/client";
import { prisma } from "@/infrastructure/prisma";
import {
  NotFoundError,
  UnauthenticatedError,
  BadRequestError,
} from "@/shared/errors/AppError";
import { hashPassword, verifyPassword } from "@/shared/utils/password";
import { buildInitials } from "@/shared/utils/text";
import {
  serializeUser,
  userWithRelations,
} from "@/shared/serializers/user.serializer";
import { buildPaginationMeta } from "@/shared/http/apiResponse";
import { toPrismaPagination } from "@/shared/http/pagination";
import type {
  AdminUserListQuery,
  UpdateProfileInput,
} from "./users.validators";

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
  async getMe(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: userWithRelations,
    });
    if (!user) throw new NotFoundError("User not found");
    return serializeUser(user);
  },

  async updateProfile(userId: string, input: UpdateProfileInput) {
    const profile = await prisma.profile.findUnique({ where: { userId } });
    if (!profile) throw new NotFoundError("Profile not found");

    const firstName = input.firstName ?? profile.firstName;
    const lastName = input.lastName ?? profile.lastName;

    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        profile: {
          update: {
            ...input,
            initials: buildInitials(firstName, lastName),
          },
        },
      },
      include: userWithRelations,
    });
    return serializeUser(updated);
  },

  async changePassword(
    userId: string,
    input: { currentPassword: string; newPassword: string },
  ) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundError("User not found");

    const valid = await verifyPassword(
      input.currentPassword,
      user.passwordHash,
    );
    if (!valid) throw new UnauthenticatedError("Current password is incorrect");

    if (await verifyPassword(input.newPassword, user.passwordHash)) {
      throw new BadRequestError(
        "New password must be different from the current password",
      );
    }

    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await hashPassword(input.newPassword) },
    });
    // Revoke existing sessions for safety.
    await prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  },

  // --- Admin operations ---------------------------------------------------

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

  async getUserById(id: string) {
    const user = await prisma.user.findUnique({
      where: { id },
      include: userWithRelations,
    });
    if (!user) throw new NotFoundError("User not found");
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

    const updated = await prisma.user.update({
      where: { id },
      data: {
        status,
        ...(status === UserStatus.SUSPENDED || status === UserStatus.BANNED
          ? { warnings: { increment: 0 } }
          : {}),
      },
      include: userWithRelations,
    });

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
        note: reason,
      },
    });

    return serializeUser(updated);
  },
};
