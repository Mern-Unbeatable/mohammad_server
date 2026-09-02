import rateLimit from "express-rate-limit";
import { StatusCodes } from "http-status-codes";
import { env } from "@/config/env";

const buildLimiter = (max: number, windowMs: number) =>
  rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
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

/** Global limiter applied to all API routes. */
export const globalRateLimiter = buildLimiter(
  env.rateLimit.max,
  env.rateLimit.windowMs,
);

/** Stricter limiter for authentication endpoints to slow brute-force attempts. */
export const authRateLimiter = buildLimiter(20, 15 * 60 * 1000);
