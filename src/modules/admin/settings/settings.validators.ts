import { z } from "zod";

export const updateSettingSchema = z.object({
  value: z.unknown(),
});

export const settingKeyParamSchema = z.object({
  key: z.string().trim().min(1).max(120),
});
