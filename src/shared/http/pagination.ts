import { z } from "zod";

/** Shared query schema for list endpoints with pagination + sorting. */
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(12),
  sort: z.enum(["asc", "desc"]).default("desc"),
  search: z.string().trim().max(200).optional(),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export interface PaginationParams {
  skip: number;
  take: number;
}

/** Translates page/pageSize into Prisma skip/take. */
export const toPrismaPagination = (
  page: number,
  pageSize: number,
): PaginationParams => ({
  skip: (page - 1) * pageSize,
  take: pageSize,
});
