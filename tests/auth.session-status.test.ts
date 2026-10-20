import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role, UserStatus } from "@prisma/client";
import { hashToken, signRefreshToken } from "@/shared/utils/jwt";

const { prismaMock, disconnectUser } = vi.hoisted(() => ({
  prismaMock: {
    user: { findUnique: vi.fn(), update: vi.fn() },
    refreshToken: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
    moderationLog: { create: vi.fn() },
  },
  disconnectUser: vi.fn(),
}));

vi.mock("@/infrastructure/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/realtime/socket", () => ({ disconnectUser }));
vi.mock("@/shared/serializers/user.serializer", () => ({
  serializeUser: (user: unknown) => user,
  serializeProfile: (profile: unknown) => profile,
  userWithRelations: {},
}));

import { authService } from "@/modules/auth/auth.service";
import { usersService } from "@/modules/admin/users/users.service";
import { ForbiddenError, UnauthenticatedError } from "@/shared/errors/AppError";

const user = (status: UserStatus) => ({
  id: "u1",
  email: "u1@test.example",
  role: Role.SUPPLIER,
  status,
});

const storedFor = (token: string, overrides: Record<string, unknown> = {}) => ({
  id: "rt1",
  userId: "u1",
  tokenHash: hashToken(token),
  expiresAt: new Date(Date.now() + 60_000),
  revokedAt: null,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("authService.refresh account status", () => {
  it("rotates the token and issues a new pair for active accounts", async () => {
    const token = signRefreshToken({ sub: "u1", jti: "j1" });
    prismaMock.refreshToken.findUnique.mockResolvedValue(storedFor(token));
    prismaMock.user.findUnique.mockResolvedValue(user(UserStatus.ACTIVE));

    const result = await authService.refresh(token);

    expect(result.accessToken).toEqual(expect.any(String));
    expect(result.refreshToken).not.toBe(token);
    expect(prismaMock.refreshToken.update).toHaveBeenCalledWith({
      where: { id: "rt1" },
      data: { revokedAt: expect.any(Date) },
    });
    expect(prismaMock.refreshToken.create).toHaveBeenCalledTimes(1);
  });

  it.each([
    [UserStatus.SUSPENDED, "This account is currently suspended"],
    [UserStatus.BANNED, "This account has been banned"],
  ])("refuses %s accounts and burns the presented token", async (status, message) => {
    const token = signRefreshToken({ sub: "u1", jti: `j-${status}` });
    prismaMock.refreshToken.findUnique.mockResolvedValue(storedFor(token));
    prismaMock.user.findUnique.mockResolvedValue(user(status));

    const attempt = authService.refresh(token);

    await expect(attempt).rejects.toBeInstanceOf(ForbiddenError);
    await expect(attempt).rejects.toThrow(message);
    expect(prismaMock.refreshToken.update).toHaveBeenCalledWith({
      where: { id: "rt1" },
      data: { revokedAt: expect.any(Date) },
    });
    expect(prismaMock.refreshToken.create).not.toHaveBeenCalled();
  });

  it("rejects a token revoked by a suspension as unauthenticated", async () => {
    const token = signRefreshToken({ sub: "u1", jti: "j-revoked" });
    prismaMock.refreshToken.findUnique.mockResolvedValue(
      storedFor(token, { revokedAt: new Date() }),
    );

    await expect(authService.refresh(token)).rejects.toBeInstanceOf(UnauthenticatedError);
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.refreshToken.create).not.toHaveBeenCalled();
  });
});

describe("usersService.updateStatus session invalidation", () => {
  beforeEach(() => {
    prismaMock.user.findUnique.mockResolvedValue(user(UserStatus.ACTIVE));
    prismaMock.user.update.mockImplementation(async ({ data }) => ({ ...user(data.status) }));
  });

  it.each([
    [UserStatus.SUSPENDED, "SUSPEND"],
    [UserStatus.BANNED, "BAN"],
  ])("revokes refresh tokens and disconnects sockets on %s", async (status, action) => {
    await usersService.updateStatus("u1", status, "admin-1", "spam");

    expect(prismaMock.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: "u1", revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(disconnectUser).toHaveBeenCalledWith("u1");
    expect(prismaMock.moderationLog.create).toHaveBeenCalledWith({
      data: { actorId: "admin-1", targetUserId: "u1", action, note: "spam" },
    });
  });

  it("leaves sessions alone when reactivating", async () => {
    prismaMock.user.findUnique.mockResolvedValue(user(UserStatus.SUSPENDED));

    await usersService.updateStatus("u1", UserStatus.ACTIVE, "admin-1");

    expect(prismaMock.refreshToken.updateMany).not.toHaveBeenCalled();
    expect(disconnectUser).not.toHaveBeenCalled();
  });
});
