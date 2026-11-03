import { z } from "zod";
import { paginationQuerySchema } from "@/shared/http/pagination";

const CONDITIONS = [
  "NEW",
  "LIKE_NEW",
  "GOOD",
  "REFURBISHED",
  "FOR_PARTS",
] as const;
const CATEGORIES = [
  "CHROMATOGRAPHY",
  "SPECTROSCOPY",
  "INCUBATION",
  "CENTRIFUGATION",
  "WEIGHING",
  "SAFETY",
  "CONSUMABLES",
  "MICROSCOPY",
  "OTHER",
] as const;

export const listingListQuerySchema = paginationQuerySchema.extend({
  category: z.enum(CATEGORIES).optional(),
  condition: z.enum(CONDITIONS).optional(),
  minPrice: z.coerce.number().nonnegative().optional(),
  maxPrice: z.coerce.number().nonnegative().optional(),
  mine: z.coerce.boolean().optional(),
  saved: z.coerce.boolean().optional(),
});

export const createListingSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(5000),
  condition: z.enum(CONDITIONS),
  category: z.enum(CATEGORIES),
  year: z.coerce.number().int().min(1980).max(2100).optional(),
  price: z.coerce.number().nonnegative(), // in euros; converted to cents in service
  location: z.string().trim().max(160).optional(),
  images: z.array(z.string().url()).max(12).default([]),
});

export const updateListingSchema = createListingSchema.partial().extend({
  status: z.enum(["ACTIVE", "SOLD", "REMOVED"]).optional(),
});

export const listingIdParamSchema = z.object({ id: z.string().uuid() });

export const enquireListingSchema = z.object({
  message: z.string().trim().min(1).max(2000),
});

export type ListingListQuery = z.infer<typeof listingListQuerySchema>;
