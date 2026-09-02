import { z } from "zod";
import { paginationQuerySchema } from "@/shared/http/pagination";

export const feedListQuerySchema = paginationQuerySchema.extend({
  type: z.enum(["question", "information", "suppliers"]).optional(),
  mine: z.coerce.boolean().optional(),
});

export const createPostSchema = z.object({
  type: z.enum(["QUESTION", "INFORMATION", "SUPPLIERS"]).default("INFORMATION"),
  content: z.string().trim().min(1).max(5000),
  imageUrl: z.string().url().optional(),
  documentUrl: z.string().url().optional(),
});

export const updatePostSchema = z.object({
  content: z.string().trim().min(1).max(5000).optional(),
  imageUrl: z.string().url().nullable().optional(),
  documentUrl: z.string().url().nullable().optional(),
});

export const createCommentSchema = z.object({
  content: z.string().trim().min(1).max(2000),
});

export const reactionSchema = z.object({
  type: z
    .enum(["LIKE", "LOVE", "CELEBRATE", "SUPPORT", "INSIGHTFUL", "CURIOUS"])
    .default("LIKE"),
});

export const postIdParamSchema = z.object({ id: z.string().uuid() });
export const commentParamSchema = z.object({
  id: z.string().uuid(),
  commentId: z.string().uuid(),
});
