import { z } from "zod";

export const statisticsQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});

export const updateSettingSchema = z.object({
  value: z.unknown(),
});

export const settingKeyParamSchema = z.object({
  key: z.string().trim().min(1).max(120),
});
