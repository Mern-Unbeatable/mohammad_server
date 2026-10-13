import { z } from "zod";

export const adminConversationListQuerySchema = z.object({
  type: z.enum(["direct", "group"]).optional(),
  search: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});

export const adminMessageListQuerySchema = z.object({
  before: z.coerce.date().optional(),
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
