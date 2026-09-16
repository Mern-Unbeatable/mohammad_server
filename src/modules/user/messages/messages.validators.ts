import { z } from "zod";
import { paginationQuerySchema } from "@/shared/http/pagination";

export const conversationListQuerySchema = z.object({
  type: z.enum(["direct", "group"]).optional(),
  search: z.string().trim().max(200).optional(),
});

export const startDirectSchema = z.object({
  participantId: z.string().uuid(),
  message: z.string().trim().min(1).max(5000),
});

export const createGroupSchema = z.object({
  name: z.string().trim().min(1).max(160),
  participantIds: z.array(z.string().uuid()).min(1).max(256),
});

export const sendMessageSchema = z.object({
  body: z.string().trim().min(1).max(5000),
});

export const conversationIdParamSchema = z.object({ id: z.string().uuid() });

export const messageIdParamSchema = z.object({
  id: z.string().uuid(),
  messageId: z.string().uuid(),
});

export const messageListQuerySchema = paginationQuerySchema.extend({
  pageSize: z.coerce.number().int().positive().max(100).default(30),
});
