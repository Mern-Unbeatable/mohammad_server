import type { Request, Response } from "express";
import { env } from "@/config/env";
import { ForbiddenError } from "@/shared/errors/AppError";
import { readCookie } from "@/shared/http/authCookies";

/** Soft cap for unauthenticated General post detail views. */
export const GUEST_GENERAL_VIEW_LIMIT = 12;

const GUEST_VIEWS_COOKIE = "lu_guest_general_views";
const COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const parseViewedIds = (raw: string | null): string[] => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return [
      ...new Set(
        parsed
          .filter((id): id is string => typeof id === "string" && UUID_RE.test(id))
          .slice(0, GUEST_GENERAL_VIEW_LIMIT),
      ),
    ];
  } catch {
    return [];
  }
};

export const readGuestGeneralViews = (req: Request): string[] =>
  parseViewedIds(readCookie(req, GUEST_VIEWS_COOKIE));

export const setGuestGeneralViewsCookie = (
  res: Response,
  viewedIds: string[],
): void => {
  res.cookie(GUEST_VIEWS_COOKIE, JSON.stringify(viewedIds), {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE_MS,
  });
};

/** Guests only see the first page, capped at the guest view limit. */
export const clampGuestGeneralListQuery = (
  req: Request,
  _res: Response,
  next: () => void,
): void => {
  if (req.user) {
    next();
    return;
  }
  const query = req.query as Record<string, unknown>;
  query.page = "1";
  query.pageSize = String(GUEST_GENERAL_VIEW_LIMIT);
  delete query.mine;
  next();
};

/**
 * Tracks unique General post ids a guest has opened. Revisits do not count again.
 * Authenticated members are unrestricted.
 */
export const enforceGuestGeneralViewLimit = (
  req: Request,
  res: Response,
  next: () => void,
): void => {
  if (req.user) {
    next();
    return;
  }

  const postId = String(req.params.id || "");
  const viewed = readGuestGeneralViews(req);

  if (viewed.includes(postId)) {
    next();
    return;
  }

  if (viewed.length >= GUEST_GENERAL_VIEW_LIMIT) {
    throw new ForbiddenError(
      "Sign up or log in to keep reading General posts.",
      {
        reason: "GUEST_VIEW_LIMIT",
        limit: GUEST_GENERAL_VIEW_LIMIT,
        viewed: viewed.length,
      },
    );
  }

  setGuestGeneralViewsCookie(res, [...viewed, postId]);
  next();
};
