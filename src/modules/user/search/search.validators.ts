import { z } from "zod";

export const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(200),
  types: z
    .string()
    .trim()
    .optional()
    .transform((value) => {
      if (!value) return ["users", "jobs", "listings", "posts", "blogs"] as const;
      return value
        .split(",")
        .map((part) => part.trim().toLowerCase())
        .filter(Boolean);
    }),
  limit: z.coerce.number().int().positive().max(20).default(5),
});

export type SearchQuery = z.infer<typeof searchQuerySchema>;
