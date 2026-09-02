import { z } from "zod";
import { paginationQuerySchema } from "@/shared/http/pagination";

const AD_CATEGORIES = ["PRODUCT", "SERVICE", "PROMO", "WEBINAR"] as const;
const AD_STATUSES = ["PENDING", "ACTIVE", "EXPIRED", "REJECTED"] as const;

export const adListQuerySchema = paginationQuerySchema.extend({
  status: z.enum(AD_STATUSES).optional(),
  category: z.enum(AD_CATEGORIES).optional(),
  mine: z.coerce.boolean().optional(),
});

export const createAdSchema = z.object({
  title: z.string().trim().min(1).max(200),
  category: z.enum(AD_CATEGORIES),
  description: z.string().trim().min(1).max(5000),
  imageUrl: z.string().url().optional(),
  videoUrl: z.string().url().optional(),
  price: z.coerce.number().nonnegative().optional(),
  contact: z.string().trim().max(200).optional(),
  location: z.string().trim().max(200).optional(),
  eventDate: z.coerce.date().optional(),
  eventTime: z.string().trim().max(20).optional(),
  organizer: z.string().trim().max(160).optional(),
  durationDays: z
    .union([z.literal(7), z.literal(14), z.literal(30)])
    .default(7),
});

export const updateAdSchema = createAdSchema.partial();

export const reviewAdSchema = z.object({
  status: z.enum(["ACTIVE", "REJECTED", "EXPIRED"]),
  rejectionReason: z.string().trim().max(1000).optional(),
});

export const adIdParamSchema = z.object({ id: z.string().uuid() });

export type AdListQuery = z.infer<typeof adListQuerySchema>;
