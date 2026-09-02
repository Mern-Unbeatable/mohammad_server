import crypto from "node:crypto";
import { ProfileType, Role, SubscriptionStatus } from "@prisma/client";
import { prisma } from "@/infrastructure/prisma";
import {
  ConflictError,
  ForbiddenError,
  UnauthenticatedError,
} from "@/shared/errors/AppError";
import { hashPassword, verifyPassword } from "@/shared/utils/password";
import {
  hashToken,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from "@/shared/utils/jwt";
import { buildInitials } from "@/shared/utils/text";
import {
  serializeUser,
  userWithRelations,
} from "@/shared/serializers/user.serializer";
import { env } from "@/config/env";
import type { LoginInput, RegisterInput } from "./auth.validators";

const PROFILE_TYPE_MAP: Record<RegisterInput["profileType"], ProfileType> = {
  laboratory: ProfileType.LABORATORY,
  hospital: ProfileType.HOSPITAL,
  clinic: ProfileType.CLINIC,
  supplier: ProfileType.SUPPLIER,
  professional: ProfileType.PROFESSIONAL,
  other: ProfileType.OTHER,
};

/** Suppliers self-identify at registration; everyone else becomes a USER. */
const resolveRole = (profileType: RegisterInput["profileType"]): Role =>
  profileType === "supplier" ? Role.SUPPLIER : Role.USER;

const parseExpiryToDate = (expiresIn: string): Date => {
  const match = /^(\d+)([smhd])$/.exec(expiresIn);
  const now = Date.now();
  if (!match) {
    return new Date(now + 7 * 24 * 60 * 60 * 1000);
  }
  const value = Number(match[1]);
  const unitMs: Record<string, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };
  return new Date(now + value * (unitMs[match[2]] ?? unitMs.d));
};

const issueTokens = async (user: { id: string; role: Role; email: string }) => {
  const accessToken = signAccessToken({
    sub: user.id,
    role: user.role,
    email: user.email,
  });
  const jti = crypto.randomUUID();
  const refreshToken = signRefreshToken({ sub: user.id, jti });

  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(refreshToken),
      expiresAt: parseExpiryToDate(env.jwt.refreshExpiresIn),
    },
  });

  return { accessToken, refreshToken };
};

export const authService = {
  async register(input: RegisterInput) {
    const existing = await prisma.user.findUnique({
      where: { email: input.email },
    });
    if (existing) {
      throw new ConflictError("An account with this email already exists");
    }

    const role = resolveRole(input.profileType);
    const passwordHash = await hashPassword(input.password);

    const user = await prisma.user.create({
      data: {
        email: input.email,
        passwordHash,
        role,
        profileType: PROFILE_TYPE_MAP[input.profileType],
        profile: {
          create: {
            firstName: input.firstName,
            lastName: input.lastName,
            title: input.jobTitle,
            company: input.company,
            country: input.country,
            phone: input.phone,
            about: input.professionalInfo,
            initials: buildInitials(input.firstName, input.lastName),
          },
        },
        subscription: {
          create: {
            plan: "FREE",
            status: SubscriptionStatus.TRIAL,
            trialDaysLeft: 90,
            trialDaysTotal: 90,
          },
        },
      },
      include: userWithRelations,
    });

    const tokens = await issueTokens(user);
    return { user: serializeUser(user), ...tokens };
  },

  async login(input: LoginInput) {
    const user = await prisma.user.findUnique({
      where: { email: input.email },
      include: userWithRelations,
    });

    if (!user) {
      throw new UnauthenticatedError("Invalid email or password");
    }

    const passwordValid = await verifyPassword(
      input.password,
      user.passwordHash,
    );
    if (!passwordValid) {
      throw new UnauthenticatedError("Invalid email or password");
    }

    if (user.status === "BANNED") {
      throw new ForbiddenError("This account has been banned");
    }
    if (user.status === "SUSPENDED") {
      throw new ForbiddenError("This account is currently suspended");
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const tokens = await issueTokens(user);
    return { user: serializeUser(user), ...tokens };
  },

  async refresh(refreshToken: string) {
    const payload = verifyRefreshToken(refreshToken);
    const tokenHash = hashToken(refreshToken);

    const stored = await prisma.refreshToken.findUnique({
      where: { tokenHash },
    });
    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new UnauthenticatedError("Invalid or expired refresh token");
    }

    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) {
      throw new UnauthenticatedError("Account no longer exists");
    }

    // Rotate: revoke the used token and issue a fresh pair.
    await prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    return issueTokens(user);
  },

  async logout(refreshToken: string) {
    const tokenHash = hashToken(refreshToken);
    await prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  },

  async me(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: userWithRelations,
    });
    if (!user) {
      throw new UnauthenticatedError("Account no longer exists");
    }
    return serializeUser(user);
  },
};
