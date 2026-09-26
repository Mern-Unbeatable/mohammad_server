import fs from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashToken } from "@/shared/utils/jwt";

const { prismaMock, sendMail } = vi.hoisted(() => ({
  prismaMock: {
    user: { findUnique: vi.fn(), update: vi.fn() },
    passwordResetToken: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
      updateMany: vi.fn(),
    },
    refreshToken: { updateMany: vi.fn() },
    $transaction: vi.fn(),
  },
  sendMail: vi.fn(),
}));

vi.mock("@/infrastructure/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/infrastructure/mailer", () => ({ sendMail }));
vi.mock("@/shared/utils/password", () => ({
  hashPassword: vi.fn(async (plain: string) => `hashed:${plain}`),
  verifyPassword: vi.fn(async (plain: string, hash: string) => hash === `hashed:${plain}`),
}));

import { authService } from "@/modules/auth/auth.service";
import { buildPasswordResetEmail } from "@/modules/auth/auth.emails";

const TOKEN = "a".repeat(64);
const future = () => new Date(Date.now() + 10 * 60 * 1000);

const activeUser = {
  id: "u1",
  email: "jane@example.com",
  status: "ACTIVE",
  profile: { firstName: "Jane" },
};

const storedToken = (overrides: Record<string, unknown> = {}) => ({
  id: "t1",
  userId: "u1",
  tokenHash: hashToken(TOKEN),
  expiresAt: future(),
  usedAt: null,
  createdAt: new Date(),
  user: { status: "ACTIVE", passwordHash: "hashed:OldPass1!" },
  ...overrides,
});

const resetInput = { token: TOKEN, password: "NewPass1!", confirmPassword: "NewPass1!" };

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.$transaction.mockImplementation(async (arg: unknown) =>
    typeof arg === "function" ? arg(prismaMock) : Promise.all(arg as Promise<unknown>[]),
  );
  prismaMock.passwordResetToken.findFirst.mockResolvedValue(null);
  prismaMock.passwordResetToken.updateMany.mockResolvedValue({ count: 1 });
  sendMail.mockResolvedValue(undefined);
});

describe("forgotPassword", () => {
  it("resolves without waiting for the lookup or the email", async () => {
    prismaMock.user.findUnique.mockReturnValue(new Promise(() => {}));
    await expect(authService.forgotPassword({ email: "jane@example.com" })).resolves.toBeUndefined();
  });
});

describe("processPasswordResetRequest", () => {
  it("does nothing for unknown emails", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    await authService.processPasswordResetRequest("nobody@example.com");
    expect(prismaMock.passwordResetToken.create).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("does nothing for banned accounts", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ ...activeUser, status: "BANNED" });
    await authService.processPasswordResetRequest(activeUser.email);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("respects the per-account cooldown", async () => {
    prismaMock.user.findUnique.mockResolvedValue(activeUser);
    prismaMock.passwordResetToken.findFirst.mockResolvedValue({ id: "recent" });
    await authService.processPasswordResetRequest(activeUser.email);
    expect(prismaMock.passwordResetToken.create).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("stores only the token hash, replaces older tokens and emails the raw token", async () => {
    prismaMock.user.findUnique.mockResolvedValue(activeUser);
    await authService.processPasswordResetRequest(activeUser.email);

    expect(prismaMock.passwordResetToken.deleteMany).toHaveBeenCalledWith({
      where: { userId: "u1" },
    });
    const { data } = prismaMock.passwordResetToken.create.mock.calls[0][0];
    expect(data.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(data.expiresAt.getTime()).toBeGreaterThan(Date.now());

    const mail = sendMail.mock.calls[0][0];
    const rawToken = /token=([a-f0-9]+)/.exec(mail.text)?.[1];
    expect(rawToken).toHaveLength(64);
    expect(rawToken).not.toBe(data.tokenHash);
    expect(hashToken(rawToken!)).toBe(data.tokenHash);
    expect(mail.to).toBe(activeUser.email);
    expect(mail.text).toContain("http://localhost:5173/reset-password?token=");
  });

  it("removes the undelivered token when the email fails", async () => {
    prismaMock.user.findUnique.mockResolvedValue(activeUser);
    sendMail.mockRejectedValue(new Error("SMTP down"));
    await expect(authService.processPasswordResetRequest(activeUser.email)).resolves.toBeUndefined();
    const { data } = prismaMock.passwordResetToken.create.mock.calls[0][0];
    expect(prismaMock.passwordResetToken.deleteMany).toHaveBeenLastCalledWith({
      where: { tokenHash: data.tokenHash },
    });
  });
});

describe("verifyResetToken", () => {
  it("accepts a valid token", async () => {
    prismaMock.passwordResetToken.findUnique.mockResolvedValue(storedToken());
    await expect(authService.verifyResetToken(TOKEN)).resolves.toMatchObject({ valid: true });
    expect(prismaMock.passwordResetToken.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tokenHash: hashToken(TOKEN) } }),
    );
  });

  it.each([
    ["unknown", null],
    ["expired", storedToken({ expiresAt: new Date(Date.now() - 1000) })],
    ["used", storedToken({ usedAt: new Date() })],
    ["banned user", storedToken({ user: { status: "BANNED", passwordHash: "x" } })],
  ])("rejects a %s token with 400", async (_label, row) => {
    prismaMock.passwordResetToken.findUnique.mockResolvedValue(row);
    await expect(authService.verifyResetToken(TOKEN)).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe("resetPassword", () => {
  it("updates the password, consumes the token and revokes sessions", async () => {
    prismaMock.passwordResetToken.findUnique.mockResolvedValue(storedToken());
    await authService.resetPassword(resetInput);

    expect(prismaMock.passwordResetToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "t1", usedAt: null }),
      }),
    );
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { passwordHash: "hashed:NewPass1!" },
    });
    expect(prismaMock.refreshToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "u1", revokedAt: null } }),
    );
  });

  it("rejects expired and reused tokens without touching the password", async () => {
    prismaMock.passwordResetToken.findUnique.mockResolvedValue(
      storedToken({ expiresAt: new Date(Date.now() - 1000) }),
    );
    await expect(authService.resetPassword(resetInput)).rejects.toMatchObject({ statusCode: 400 });

    prismaMock.passwordResetToken.findUnique.mockResolvedValue(storedToken({ usedAt: new Date() }));
    await expect(authService.resetPassword(resetInput)).rejects.toMatchObject({ statusCode: 400 });

    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("rejects the second of two racing requests", async () => {
    prismaMock.passwordResetToken.findUnique.mockResolvedValue(storedToken());
    prismaMock.passwordResetToken.updateMany.mockResolvedValue({ count: 0 });
    await expect(authService.resetPassword(resetInput)).rejects.toMatchObject({ statusCode: 400 });
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("rejects reusing the current password with 422", async () => {
    prismaMock.passwordResetToken.findUnique.mockResolvedValue(
      storedToken({ user: { status: "ACTIVE", passwordHash: "hashed:NewPass1!" } }),
    );
    await expect(authService.resetPassword(resetInput)).rejects.toMatchObject({ statusCode: 422 });
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });
});

describe("buildPasswordResetEmail", () => {
  const email = buildPasswordResetEmail({
    to: "jane@example.com",
    resetUrl: "https://app.example.com/reset-password?token=abc",
    ttlMinutes: 30,
    firstName: "<b>Jane</b>",
  });

  it("includes the link and expiry in text and HTML", () => {
    expect(email.subject).toBe("Reset your Lab Unity password");
    expect(email.text).toContain("https://app.example.com/reset-password?token=abc");
    expect(email.text).toContain("30 minutes");
    expect(email.html).toContain('href="https://app.example.com/reset-password?token=abc"');
    expect(email.html).toContain("30 minutes");
  });

  it("escapes user-provided names in HTML", () => {
    expect(email.html).toContain("Hi &lt;b&gt;Jane&lt;/b&gt;,");
    expect(email.html).not.toContain("<b>Jane</b>");
  });

  it("embeds the logo as an inline image", () => {
    const logo = email.attachments?.[0];
    expect(logo?.cid).toBe("labunity-logo");
    expect(fs.existsSync(String(logo?.path))).toBe(true);
    expect(email.html).toContain('src="cid:labunity-logo"');
  });

  it("formats whole hours", () => {
    const hourly = buildPasswordResetEmail({ to: "a@b.c", resetUrl: "u", ttlMinutes: 60 });
    expect(hourly.text).toContain("1 hour");
  });
});
