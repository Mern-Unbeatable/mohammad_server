import type { Request, Response } from "express";
import { env } from "@/config/env";

export const ACCESS_COOKIE = "accessToken";
export const REFRESH_COOKIE = "refreshToken";

const ACCESS_MAX_AGE_MS = 15 * 60 * 1000; // mirrors JWT_ACCESS_EXPIRES_IN default
const REFRESH_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // mirrors JWT_REFRESH_EXPIRES_IN default

/**
 * httpOnly auth cookies so access/refresh tokens are never exposed to
 * JavaScript (mitigates XSS token theft). SameSite=strict blocks cross-site
 * delivery, which also provides CSRF protection for cookie-authenticated
 * state-changing requests.
 */
const baseOptions = {
  httpOnly: true,
  secure: env.isProduction,
  sameSite: "strict" as const,
  path: "/",
};

/** Minimal cookie-header parser (avoids adding a cookie-parser dependency). */
export const readCookie = (req: Request, name: string): string | null => {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return null;
};

export const readAccessCookie = (req: Request): string | null =>
  readCookie(req, ACCESS_COOKIE);

export const readRefreshCookie = (req: Request): string | null =>
  readCookie(req, REFRESH_COOKIE);

export const setAuthCookies = (
  res: Response,
  tokens: { accessToken?: string; refreshToken?: string },
): void => {
  if (tokens.accessToken) {
    res.cookie(ACCESS_COOKIE, tokens.accessToken, {
      ...baseOptions,
      maxAge: ACCESS_MAX_AGE_MS,
    });
  }
  if (tokens.refreshToken) {
    res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
      ...baseOptions,
      maxAge: REFRESH_MAX_AGE_MS,
    });
  }
};

export const clearAuthCookies = (res: Response): void => {
  res.clearCookie(ACCESS_COOKIE, baseOptions);
  res.clearCookie(REFRESH_COOKIE, baseOptions);
};
