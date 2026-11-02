import { z } from "zod";
import { paginationQuerySchema } from "@/shared/http/pagination";
import {
  DEFAULT_AD_DURATION_DAYS,
  isSponsoredDuration,
} from "@/modules/admin/settings/settings.pricing";

const AD_CATEGORIES = ["PRODUCT", "SERVICE", "PROMO", "WEBINAR"] as const;
const AD_DESTINATION_MODES = ["INTERNAL", "EXTERNAL"] as const;
const AD_STATUSES = [
  "PENDING_PAYMENT",
  "PENDING",
  "ACTIVE",
  "EXPIRED",
  "REJECTED",
  "CANCELLED",
] as const;

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
  destinationMode: z.enum(AD_DESTINATION_MODES),
  destinationResourceId: z.string().uuid().optional(),
  destinationUrl: z
    .string()
    .url()
    .refine(
      (value) => /^https?:\/\//i.test(value),
      "URL must start with http:// or https://",
    )
    .optional(),
  durationDays: z
    .number()
    .int()
    .refine(isSponsoredDuration, "Unsupported advertisement duration")
    .default(DEFAULT_AD_DURATION_DAYS),
});

export const updateAdSchema = createAdSchema.partial();

export const reviewAdSchema = z.object({
  status: z.enum(["ACTIVE", "REJECTED", "EXPIRED"]),
  rejectionReason: z.string().trim().max(1000).optional(),
});

export const confirmAdCheckoutSchema = z.object({
  sessionId: z.string().trim().min(10).max(255),
});

export const adIdParamSchema = z.object({ id: z.string().uuid() });

export type AdListQuery = z.infer<typeof adListQuerySchema>;
