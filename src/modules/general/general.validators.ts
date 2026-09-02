import { z } from "zod";
import { paginationQuerySchema } from "@/shared/http/pagination";

export const generalListQuerySchema = paginationQuerySchema.extend({
  type: z.enum(["news", "document"]).optional(),
  mine: z.coerce.boolean().optional(),
});

export const createGeneralPostSchema = z
  .object({
    type: z.enum(["NEWS", "DOCUMENT"]),
    title: z.string().trim().min(1).max(300),
    summary: z.string().trim().max(5000).optional(),
    category: z.string().trim().max(120).optional(),
    source: z.string().trim().max(120).optional(),
    imageUrl: z.string().url().optional(),
    documentUrl: z.string().url().optional(),
    body: z.array(z.string().trim()).max(100).default([]),
  })
  .refine((data) => data.type !== "DOCUMENT" || Boolean(data.documentUrl), {
    message: "A document upload is required for document posts",
    path: ["documentUrl"],
  });

export const updateGeneralPostSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  summary: z.string().trim().max(5000).optional(),
  category: z.string().trim().max(120).optional(),
  source: z.string().trim().max(120).optional(),
  imageUrl: z.string().url().nullable().optional(),
  documentUrl: z.string().url().nullable().optional(),
  body: z.array(z.string().trim()).max(100).optional(),
});

export const generalIdParamSchema = z.object({ id: z.string().uuid() });
