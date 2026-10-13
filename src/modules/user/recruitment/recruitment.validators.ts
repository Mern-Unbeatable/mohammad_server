import { z } from "zod";
import { paginationQuerySchema } from "@/shared/http/pagination";

const EMPLOYMENT = [
  "FULL_TIME",
  "PART_TIME",
  "CONTRACT",
  "INTERNSHIP",
] as const;
const LEVELS = ["ENTRY_LEVEL", "MID_LEVEL", "SENIOR"] as const;

export const jobListQuerySchema = paginationQuerySchema.extend({
  level: z.enum(LEVELS).optional(),
  employmentType: z.enum(EMPLOYMENT).optional(),
  mine: z.coerce.boolean().optional(),
  since: z.enum(["7d", "30d", "90d"]).optional(),
});

export const createJobSchema = z.object({
  title: z.string().trim().min(1).max(200),
  company: z.string().trim().min(1).max(160),
  location: z.string().trim().min(1).max(160),
  employmentType: z.enum(EMPLOYMENT),
  level: z.enum(LEVELS),
  salary: z.string().trim().max(120).optional(),
  applyLink: z.string().url().optional(),
  imageUrl: z.string().url().optional(),
  about: z.string().trim().min(1).max(8000),
  requirements: z.array(z.string().trim().min(1)).max(50).default([]),
});

export const updateJobSchema = createJobSchema.partial().extend({
  status: z.enum(["OPEN", "CLOSED", "REMOVED"]).optional(),
});

export const applyJobSchema = z.object({
  coverLetter: z.string().trim().max(4000).optional(),
});

export const jobIdParamSchema = z.object({ id: z.string().uuid() });

export const myApplicationsQuerySchema = paginationQuerySchema;

export type JobListQuery = z.infer<typeof jobListQuerySchema>;
export type MyApplicationsQuery = z.infer<typeof myApplicationsQuerySchema>;
