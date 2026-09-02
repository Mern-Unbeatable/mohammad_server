import { Response } from "express";
import { StatusCodes } from "http-status-codes";

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

interface SuccessOptions<T> {
  data: T;
  statusCode?: number;
  message?: string;
  meta?: PaginationMeta | Record<string, unknown>;
}

/** Sends a consistent success envelope. */
export const sendSuccess = <T>(
  res: Response,
  options: SuccessOptions<T>,
): Response => {
  const { data, statusCode = StatusCodes.OK, message, meta } = options;
  return res.status(statusCode).json({
    success: true,
    ...(message ? { message } : {}),
    data,
    ...(meta ? { meta } : {}),
  });
};

export const buildPaginationMeta = (
  page: number,
  pageSize: number,
  total: number,
): PaginationMeta => ({
  page,
  pageSize,
  total,
  totalPages: Math.max(1, Math.ceil(total / pageSize)),
});
