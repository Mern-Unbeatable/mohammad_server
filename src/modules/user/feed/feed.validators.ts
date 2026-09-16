import { z } from "zod";
import { paginationQuerySchema } from "@/shared/http/pagination";

export const REACTION_TYPES = [
  "like",
  "love",
  "haha",
  "wow",
  "sad",
  "angry",
] as const;

export type ReactionTypeValue = (typeof REACTION_TYPES)[number];

export const feedListQuerySchema = paginationQuerySchema.extend({
  type: z.enum(["question", "information", "suppliers"]).optional(),
  mine: z.coerce.boolean().optional(),
});

export const createPostSchema = z
  .object({
    type: z.enum(["QUESTION", "INFORMATION", "SUPPLIERS"]).default("INFORMATION"),
    content: z.string().trim().max(5000).optional().default(""),
    imageUrl: z.string().url().optional(),
    documentUrl: z.string().url().optional(),
  })
  .superRefine((data, ctx) => {
    if (!data.content && !data.imageUrl && !data.documentUrl) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Post must include content, an image, or a document",
        path: ["content"],
      });
    }
  });

export const updatePostSchema = z.object({
  content: z.string().trim().min(1).max(5000).optional(),
  imageUrl: z.string().url().nullable().optional(),
  documentUrl: z.string().url().nullable().optional(),
});

export const createCommentSchema = z.object({
  content: z.string().trim().min(1).max(2000),
  parentCommentId: z.string().uuid().optional().nullable(),
});

/** Accepts UI ids or legacy uppercase enums; stores normalized lowercase text. */
export const reactionSchema = z.object({
  type: z
    .enum([
      ...REACTION_TYPES,
      "LIKE",
      "LOVE",
      "CELEBRATE",
      "SUPPORT",
      "INSIGHTFUL",
      "CURIOUS",
      "celebrate",
      "support",
      "insightful",
      "curious",
    ])
    .default("like")
    .transform((value): ReactionTypeValue => {
      const normalized = value.toLowerCase();
      const legacy: Record<string, ReactionTypeValue> = {
        celebrate: "haha",
        support: "wow",
        insightful: "sad",
        curious: "angry",
      };
      return legacy[normalized] ?? (normalized as ReactionTypeValue);
    }),
});

export const postIdParamSchema = z.object({ id: z.string().uuid() });
export const commentParamSchema = z.object({
  id: z.string().uuid(),
  commentId: z.string().uuid(),
});
