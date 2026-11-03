import { z } from "zod";
import { cursorParam } from "@/shared/http/cursor";

export const adminConversationListQuerySchema = z.object({
  type: z.enum(["direct", "group"]).optional(),
  search: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  /** `meta.nextCursor` from the previous page; takes precedence over `page`. */
  cursor: cursorParam.optional(),
});

export const adminMessageListQuerySchema = z.object({
  before: z.coerce.date().optional(),
  /** Id of the oldest loaded message; with `before` forms an exact (createdAt, id) cursor. */
  beforeId: z.string().uuid().optional(),
  pageSize: z.coerce.number().int().positive().max(100).default(50),
});

export const adminConversationIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const adminMessageIdParamSchema = z.object({
  id: z.string().uuid(),
  messageId: z.string().uuid(),
});

export type AdminConversationListQuery = z.infer<
  typeof adminConversationListQuerySchema
>;
export type AdminMessageListQuery = z.infer<typeof adminMessageListQuerySchema>;
