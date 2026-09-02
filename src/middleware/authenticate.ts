import { NextFunction, Request, Response } from "express";
import { verifyAccessToken } from "@/shared/utils/jwt";
import { UnauthenticatedError } from "@/shared/errors/AppError";

const extractToken = (req: Request): string | null => {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    return header.slice(7).trim();
  }
  return null;
};

/** Requires a valid access token; attaches the principal to req.user. */
export const authenticate = (
  req: Request,
  _res: Response,
  next: NextFunction,
): void => {
  const token = extractToken(req);
  if (!token) {
    throw new UnauthenticatedError();
  }
  const payload = verifyAccessToken(token);
  req.user = { id: payload.sub, role: payload.role, email: payload.email };
  next();
};

/** Attaches req.user when a token is present, but never rejects the request. */
export const optionalAuthenticate = (
  req: Request,
  _res: Response,
  next: NextFunction,
): void => {
  const token = extractToken(req);
  if (!token) {
    next();
    return;
  }
  try {
    const payload = verifyAccessToken(token);
    req.user = { id: payload.sub, role: payload.role, email: payload.email };
  } catch {
    // Ignore invalid tokens on optional routes.
  }
  next();
};
