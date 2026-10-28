import type { Request } from "express";
import rateLimit from "express-rate-limit";
import { StatusCodes } from "http-status-codes";
import { env } from "@/config/env";

const buildLimiter = (
  max: number,
  windowMs: number,
  keyGenerator?: (req: Request) => string,
) =>
  rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    ...(keyGenerator ? { keyGenerator } : {}),
    handler: (_req, res) => {
      res.status(StatusCodes.TOO_MANY_REQUESTS).json({
        success: false,
        error: {
          code: "RATE_LIMITED",
          message: "Too many requests, please try again later",
        },
      });
    },
  });

/**
 * Keys by account after `authenticate`, so users behind one NAT do not share
 * a budget and one account cannot dodge limits by switching IPs. Counters are
 * kept in process memory (one API instance); see the deployment notes.
 */
const byUser = (req: Request) => (req.user ? `user:${req.user.id}` : `ip:${req.ip}`);

/** Global limiter applied to all API routes. */
export const globalRateLimiter = buildLimiter(
  env.rateLimit.max,
  env.rateLimit.windowMs,
);

/** Stricter limiter for authentication endpoints to slow brute-force attempts. */
export const authRateLimiter = buildLimiter(20, 15 * 60 * 1000);

/** Public contact form: 5 messages per hour per IP. */
export const contactRateLimiter = buildLimiter(5, 60 * 60 * 1000);

/** New chat messages, direct chats and groups: 30 per minute per account. */
export const chatSendRateLimiter = buildLimiter(30, 60 * 1000, byUser);

/** File uploads (chat and public): 40 requests per 10 minutes per account. */
export const uploadRateLimiter = buildLimiter(40, 10 * 60 * 1000, byUser);

/** Signed chat attachment downloads (images render many at once): per IP. */
export const attachmentDownloadRateLimiter = buildLimiter(600, 15 * 60 * 1000);
