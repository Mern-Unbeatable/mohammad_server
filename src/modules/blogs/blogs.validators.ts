import { z } from "zod";
import { paginationQuerySchema } from "@/shared/http/pagination";

export const blogListQuerySchema = paginationQuerySchema.extend({
  category: z.string().trim().max(120).optional(),
});

export const createBlogSchema = z.object({
  title: z.string().trim().min(1).max(300),
  category: z.string().trim().min(1).max(120),
  excerpt: z.string().trim().min(1).max(1000),
  body: z.string().trim().min(1),
  image: z.string().url().optional(),
  readTime: z.string().trim().max(40).optional(),
  slug: z.string().trim().max(300).optional(),
  publish: z.boolean().optional().default(true),
});

export const updateBlogSchema = createBlogSchema.partial();

export const blogIdParamSchema = z.object({ id: z.string().uuid() });
export const blogSlugParamSchema = z.object({ slug: z.string().trim().min(1) });

export type BlogListQuery = z.infer<typeof blogListQuerySchema>;
