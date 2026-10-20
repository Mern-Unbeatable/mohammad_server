import { z } from "zod";
import { paginationQuerySchema } from "@/shared/http/pagination";

const EMPLOYMENT = [
  "FULL_TIME",
  "PART_TIME",
  "CONTRACT",
  "INTERNSHIP",
] as const;
const WORKPLACE = ["ON_SITE", "REMOTE", "HYBRID"] as const;
const LEVELS = ["ENTRY_LEVEL", "MID_LEVEL", "SENIOR"] as const;
const STATUSES = ["OPEN", "CLOSED", "REMOVED"] as const;

/** `z.coerce.boolean()` turns the string "false" into `true`. */
const queryBoolean = z.preprocess((value) => {
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  return value;
}, z.boolean());

export const jobListQuerySchema = paginationQuerySchema.extend({
  level: z.enum(LEVELS).optional(),
  employmentType: z.enum(EMPLOYMENT).optional(),
  workplaceType: z.enum(WORKPLACE).optional(),
  mine: queryBoolean.optional(),
  /** Only honoured with `mine`; the public list is always OPEN. */
  status: z.enum(STATUSES).optional(),
  since: z.enum(["7d", "30d", "90d"]).optional(),
});

export const createJobSchema = z.object({
  title: z.string().trim().min(1).max(200),
  company: z.string().trim().min(1).max(160),
  location: z.string().trim().min(1).max(160),
  employmentType: z.enum(EMPLOYMENT),
  workplaceType: z.enum(WORKPLACE).optional(),
  level: z.enum(LEVELS),
  salary: z.string().trim().max(120).optional(),
  applyLink: z.string().url().optional(),
  imageUrl: z.string().url().optional(),
  about: z.string().trim().min(1).max(8000),
  requirements: z.array(z.string().trim().min(1)).max(50).default([]),
});

export const updateJobSchema = createJobSchema.partial().extend({
  /** `null` removes the image. */
  imageUrl: z.string().url().nullable().optional(),
  status: z.enum(STATUSES).optional(),
});

export const applyJobSchema = z.object({
  coverLetter: z.string().trim().max(4000).optional(),
});

export const jobIdParamSchema = z.object({ id: z.string().uuid() });

/** `applied` = every non-cancelled application; `cancelled` = withdrawn ones. */
export const myApplicationsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(["applied", "cancelled"]).optional(),
});

export type JobListQuery = z.infer<typeof jobListQuerySchema>;
export type MyApplicationsQuery = z.infer<typeof myApplicationsQuerySchema>;
