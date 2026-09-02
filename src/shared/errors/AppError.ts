import { StatusCodes } from "http-status-codes";

/** Machine-readable error codes returned to API consumers. */
export type ErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "PAYLOAD_TOO_LARGE"
  | "BAD_REQUEST"
  | "INTERNAL_ERROR";

/**
 * Base application error. Every operational (expected) error thrown in the
 * codebase extends this class so the central error handler can translate it
 * into a consistent HTTP response.
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: ErrorCode;
  public readonly details?: unknown;
  public readonly isOperational: boolean;

  constructor(
    message: string,
    statusCode: number,
    code: ErrorCode,
    details?: unknown,
    isOperational = true,
  ) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = isOperational;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class BadRequestError extends AppError {
  constructor(message = "Bad request", details?: unknown) {
    super(message, StatusCodes.BAD_REQUEST, "BAD_REQUEST", details);
  }
}

export class ValidationError extends AppError {
  constructor(message = "Validation failed", details?: unknown) {
    super(
      message,
      StatusCodes.UNPROCESSABLE_ENTITY,
      "VALIDATION_ERROR",
      details,
    );
  }
}

export class UnauthenticatedError extends AppError {
  constructor(message = "Authentication required") {
    super(message, StatusCodes.UNAUTHORIZED, "UNAUTHENTICATED");
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You do not have permission to perform this action") {
    super(message, StatusCodes.FORBIDDEN, "FORBIDDEN");
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Resource not found") {
    super(message, StatusCodes.NOT_FOUND, "NOT_FOUND");
  }
}

export class ConflictError extends AppError {
  constructor(message = "Resource already exists", details?: unknown) {
    super(message, StatusCodes.CONFLICT, "CONFLICT", details);
  }
}
