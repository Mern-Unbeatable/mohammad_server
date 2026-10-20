import { NextFunction, Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { JsonWebTokenError, TokenExpiredError } from "jsonwebtoken";
import { MulterError } from "multer";
import { env } from "@/config/env";
import { AppError } from "@/shared/errors/AppError";
import { logger } from "@/config/logger";

interface NormalizedError {
  statusCode: number;
  code: string;
  message: string;
  details?: unknown;
}

const normalize = (err: unknown): NormalizedError => {
  if (err instanceof AppError) {
    return {
      statusCode: err.statusCode,
      code: err.code,
      message: err.message,
      details: err.details,
    };
  }

  if (err instanceof MulterError) {
    const tooLarge = err.code === "LIMIT_FILE_SIZE";
    return {
      statusCode: tooLarge ? StatusCodes.REQUEST_TOO_LONG : StatusCodes.BAD_REQUEST,
      code: tooLarge ? "FILE_TOO_LARGE" : "BAD_REQUEST",
      message: tooLarge
        ? `Files must be ${env.upload.maxSizeMb} MB or smaller`
        : err.code === "LIMIT_FILE_COUNT"
          ? `Upload at most ${env.upload.maxFiles} files at once`
          : err.code === "LIMIT_UNEXPECTED_FILE"
            ? "Too many files, or an unexpected file field"
            : "Invalid upload request",
    };
  }

  if (err instanceof ZodError) {
    return {
      statusCode: StatusCodes.UNPROCESSABLE_ENTITY,
      code: "VALIDATION_ERROR",
      message: "Validation failed",
      details: err.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    };
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      const target = (err.meta?.target as string[] | undefined)?.join(", ");
      return {
        statusCode: StatusCodes.CONFLICT,
        code: "CONFLICT",
        message: target
          ? `A record with this ${target} already exists`
          : "Duplicate record",
      };
    }
    if (err.code === "P2025") {
      return {
        statusCode: StatusCodes.NOT_FOUND,
        code: "NOT_FOUND",
        message: "Resource not found",
      };
    }
  }

  if (err instanceof TokenExpiredError) {
    return {
      statusCode: StatusCodes.UNAUTHORIZED,
      code: "UNAUTHENTICATED",
      message: "Session expired, please sign in again",
    };
  }

  if (err instanceof JsonWebTokenError) {
    return {
      statusCode: StatusCodes.UNAUTHORIZED,
      code: "UNAUTHENTICATED",
      message: "Invalid authentication token",
    };
  }

  return {
    statusCode: StatusCodes.INTERNAL_SERVER_ERROR,
    code: "INTERNAL_ERROR",
    message: "Something went wrong",
  };
};

export const errorHandler = (
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  const normalized = normalize(err);

  if (normalized.statusCode >= 500) {
    logger.error({ err }, "Unhandled error");
  }

  res.status(normalized.statusCode).json({
    success: false,
    error: {
      code: normalized.code,
      message: normalized.message,
      ...(normalized.details ? { details: normalized.details } : {}),
    },
  });
};
