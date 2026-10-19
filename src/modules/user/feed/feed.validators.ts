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
  /** One member's posts (profile pages); `mine` takes precedence. */
  authorId: z.string().uuid().optional(),
});

export const MAX_POST_IMAGES = 10;

/** `z.string().url()` also accepts `javascript:` / `data:` URLs, which clients render as links. */
const mediaUrlSchema = z
  .string()
  .url()
  .refine((value) => /^https?:\/\//i.test(value), "URL must start with http:// or https://");

const imageUrlsSchema = z
  .array(mediaUrlSchema)
  .max(MAX_POST_IMAGES, `A post can have at most ${MAX_POST_IMAGES} images`);

/** `imageUrl` is the older single-image field; it is folded into `imageUrls`. */
export const createPostSchema = z
  .object({
    type: z.enum(["QUESTION", "INFORMATION", "SUPPLIERS"]).default("INFORMATION"),
    content: z.string().trim().max(5000).optional().default(""),
    imageUrls: imageUrlsSchema.optional(),
    imageUrl: mediaUrlSchema.optional(),
    documentUrl: mediaUrlSchema.optional(),
  })
  .transform(({ imageUrl, imageUrls, ...rest }, ctx) => {
    const data = { ...rest, imageUrls: imageUrls ?? (imageUrl ? [imageUrl] : []) };
    if (!data.content && !data.imageUrls.length && !data.documentUrl) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Post must include content, an image, or a document",
        path: ["content"],
      });
      return z.NEVER;
    }
    return data;
  });

export type CreatePostInput = z.infer<typeof createPostSchema>;

/**
 * Empty content is allowed here; the service rejects edits that leave a post empty.
 * An empty `imageUrls` (or `imageUrl: null`) removes every image.
 */
export const updatePostSchema = z
  .object({
    content: z.string().trim().max(5000).optional(),
    imageUrls: imageUrlsSchema.optional(),
    imageUrl: mediaUrlSchema.nullable().optional(),
    documentUrl: mediaUrlSchema.nullable().optional(),
  })
  .transform(({ imageUrl, imageUrls, ...rest }) => ({
    ...rest,
    imageUrls:
      imageUrls ??
      (imageUrl === undefined ? undefined : imageUrl ? [imageUrl] : []),
  }));

export type UpdatePostInput = z.infer<typeof updatePostSchema>;

export const repostSchema = z.object({
  content: z.string().trim().max(5000).optional().default(""),
});

export const createCommentSchema = z.object({
  content: z.string().trim().min(1).max(2000),
  parentCommentId: z.string().uuid().optional().nullable(),
});

export const updateCommentSchema = z.object({
  content: z.string().trim().min(1, "Comment can't be empty").max(2000),
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
