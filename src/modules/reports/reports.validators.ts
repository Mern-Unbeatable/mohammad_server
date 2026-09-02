import { z } from "zod";
import { paginationQuerySchema } from "@/shared/http/pagination";

const REASONS = [
  "HARASSMENT",
  "FRAUD_OR_SCAM",
  "SPAM",
  "MISINFORMATION",
  "HATEFUL_SPEECH",
  "THREATS_OR_VIOLENCE",
  "SELF_HARM",
  "EXTREMIST_ORGANIZATIONS",
  "GRAPHIC_CONTENT",
  "SEXUAL_CONTENT",
  "FAKE_ACCOUNT",
  "CHILD_EXPLOITATION",
  "RESTRICTED_GOODS",
  "NONCONSENSUAL_IMAGERY",
] as const;

const TARGET_TYPES = [
  "POST",
  "COMMENT",
  "LISTING",
  "JOB",
  "GENERAL_POST",
  "USER",
] as const;

export const createReportSchema = z.object({
  targetType: z.enum(TARGET_TYPES),
  targetId: z.string().uuid().optional(),
  reportedUserId: z.string().uuid().optional(),
  targetSnippet: z.string().trim().max(1000).optional(),
  reason: z.enum(REASONS),
  reasonDetail: z.string().trim().max(2000).optional(),
});

export const reportListQuerySchema = paginationQuerySchema.extend({
  status: z.enum(["pending", "under_review", "resolved"]).optional(),
});

export const moderateSchema = z.object({
  action: z.enum(["WARN", "SUSPEND", "BAN", "REMOVE_CONTENT", "DISMISS"]),
  note: z.string().trim().max(1000).optional(),
});

export const updateReportStatusSchema = z.object({
  status: z.enum(["PENDING", "UNDER_REVIEW", "RESOLVED"]),
});

export const reportIdParamSchema = z.object({ id: z.string().uuid() });

export type ReportListQuery = z.infer<typeof reportListQuerySchema>;
