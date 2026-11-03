import { prisma } from "@/infrastructure/prisma";
import {
  NotFoundError,
  UnauthenticatedError,
  BadRequestError,
} from "@/shared/errors/AppError";
import { hashPassword, verifyPassword } from "@/shared/utils/password";
import { buildInitials } from "@/shared/utils/text";
import { composeLocation, resolveProfileLocation } from "@/shared/utils/location";
import {
  serializeUser,
  userWithRelations,
} from "@/shared/serializers/user.serializer";
import type { UpdateProfileInput } from "./profile.validators";

export const profileService = {
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

    const { city, ...fields } = input;
    const firstName = fields.firstName ?? profile.firstName;
    const lastName = fields.lastName ?? profile.lastName;
    const locationChanged = city !== undefined || fields.country !== undefined;
    const location = locationChanged
      ? composeLocation(
          city ?? resolveProfileLocation(profile.location, profile.country).city,
          fields.country ?? profile.country,
        ) || null
      : undefined;

    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        profile: {
          update: {
            ...fields,
            ...(locationChanged ? { location } : {}),
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
    await prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  },
};
