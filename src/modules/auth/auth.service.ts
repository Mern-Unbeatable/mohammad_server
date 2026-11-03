import crypto from "node:crypto";
import { ProfileType, Role, SubscriptionStatus } from "@prisma/client";
import { prisma } from "@/infrastructure/prisma";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  UnauthenticatedError,
  ValidationError,
} from "@/shared/errors/AppError";
import { sendMail } from "@/infrastructure/mailer";
import { buildPasswordResetEmail } from "./auth.emails";
import { logger } from "@/config/logger";
import { hashPassword, verifyPassword } from "@/shared/utils/password";
import {
  hashToken,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from "@/shared/utils/jwt";
import { buildInitials } from "@/shared/utils/text";
import { composeLocation } from "@/shared/utils/location";
import {
  serializeUser,
  userWithRelations,
} from "@/shared/serializers/user.serializer";
import { env } from "@/config/env";
import type {
  ForgotPasswordInput,
  LoginInput,
  RegisterInput,
  ResetPasswordInput,
} from "./auth.validators";

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

const INVALID_RESET_TOKEN_MESSAGE =
  "This password reset link is invalid or has expired";

/** Returns the stored token if it can still be used, otherwise null. */
const findUsableResetToken = async (token: string) => {
  const stored = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { select: { status: true, passwordHash: true } } },
  });
  if (
    !stored ||
    stored.usedAt ||
    stored.expiresAt <= new Date() ||
    stored.user.status === "BANNED"
  ) {
    return null;
  }
  return stored;
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
            location: composeLocation(input.city, input.country) || null,
            phone: input.phone,
            about: input.professionalInfo,
            initials: buildInitials(input.firstName, input.lastName),
          },
        },
        subscription: {
          create: {
            plan: "FREE",
            status: SubscriptionStatus.TRIAL,
            startDate: new Date(),
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
      const suspension = await prisma.moderationLog.findFirst({
        where: { targetUserId: user.id, action: "SUSPEND" },
        orderBy: { createdAt: "desc" },
        select: { note: true, createdAt: true },
      });
      throw new ForbiddenError("This account is currently suspended", {
        accountStatus: "SUSPENDED",
        suspensionReason: suspension?.note?.trim() || null,
        suspendedAt: suspension?.createdAt ?? null,
      });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const tokens = await issueTokens(user);
    return { user: serializeUser(user), ...tokens };
  },

  async refresh(refreshToken: string | undefined | null) {
    if (!refreshToken) {
      throw new UnauthenticatedError("Invalid or expired refresh token");
    }
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

    // Same rule as login: suspended or banned accounts get no new session.
    if (user.status === "BANNED") {
      throw new ForbiddenError("This account has been banned");
    }
    if (user.status === "SUSPENDED") {
      throw new ForbiddenError("This account is currently suspended", {
        accountStatus: "SUSPENDED",
      });
    }

    return issueTokens(user);
  },

  async logout(refreshToken: string) {
    const tokenHash = hashToken(refreshToken);
    await prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  },

  /**
   * Resolves immediately without revealing whether the email is registered.
   * The lookup and email run after the response so response time is the
   * same for known and unknown addresses.
   */
  async forgotPassword(input: ForgotPasswordInput) {
    authService.processPasswordResetRequest(input.email).catch((error) => {
      logger.error({ err: error }, "Password reset request failed");
    });
  },

  /**
   * Issues a single-use reset token (only its SHA-256 hash is stored) and
   * emails the link. Any older tokens for the account are discarded.
   */
  async processPasswordResetRequest(email: string) {
    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        status: true,
        profile: { select: { firstName: true } },
      },
    });
    if (!user || user.status === "BANNED") return;

    const now = new Date();
    const recent = await prisma.passwordResetToken.findFirst({
      where: {
        userId: user.id,
        usedAt: null,
        createdAt: {
          gt: new Date(now.getTime() - env.passwordResetCooldownSeconds * 1000),
        },
      },
      select: { id: true },
    });
    if (recent) return;

    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = hashToken(token);

    await prisma.$transaction([
      prisma.passwordResetToken.deleteMany({ where: { userId: user.id } }),
      prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash,
          expiresAt: new Date(
            now.getTime() + env.passwordResetTtlMinutes * 60 * 1000,
          ),
        },
      }),
    ]);

    try {
      await sendMail(
        buildPasswordResetEmail({
          to: user.email,
          resetUrl: `${env.frontendUrl}/reset-password?token=${token}`,
          ttlMinutes: env.passwordResetTtlMinutes,
          firstName: user.profile?.firstName,
        }),
      );
    } catch (error) {
      // Drop the undelivered token so the cooldown doesn't block a retry.
      await prisma.passwordResetToken.deleteMany({ where: { tokenHash } });
      const { code, responseCode } = (error ?? {}) as {
        code?: string;
        responseCode?: number;
      };
      logger.error(
        { userId: user.id, code, responseCode },
        "Failed to send password reset email",
      );
    }
  },

  /** Lets the reset page show an expired/invalid state before the form is filled. */
  async verifyResetToken(token: string) {
    const stored = await findUsableResetToken(token);
    if (!stored) throw new BadRequestError(INVALID_RESET_TOKEN_MESSAGE);
    return { valid: true, expiresAt: stored.expiresAt };
  },

  async resetPassword(input: ResetPasswordInput) {
    const stored = await findUsableResetToken(input.token);
    if (!stored) throw new BadRequestError(INVALID_RESET_TOKEN_MESSAGE);

    if (await verifyPassword(input.password, stored.user.passwordHash)) {
      throw new ValidationError(
        "New password must be different from your current password",
      );
    }

    const passwordHash = await hashPassword(input.password);

    await prisma.$transaction(async (tx) => {
      const now = new Date();
      // Claiming the row inside the transaction makes the token single-use
      // even when two requests race with the same link.
      const claimed = await tx.passwordResetToken.updateMany({
        where: { id: stored.id, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (claimed.count !== 1) {
        throw new BadRequestError(INVALID_RESET_TOKEN_MESSAGE);
      }

      await tx.user.update({
        where: { id: stored.userId },
        data: { passwordHash },
      });
      await tx.passwordResetToken.deleteMany({
        where: { userId: stored.userId, id: { not: stored.id } },
      });
      await tx.refreshToken.updateMany({
        where: { userId: stored.userId, revokedAt: null },
        data: { revokedAt: now },
      });
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
