import { z } from "zod";
import { paginationQuerySchema } from "@/shared/http/pagination";

export const adminUserListQuerySchema = paginationQuerySchema.extend({
  role: z.enum(["user", "supplier", "admin"]).optional(),
  status: z.enum(["active", "suspended", "banned"]).optional(),
  plan: z.enum(["free", "monthly", "yearly"]).optional(),
});

export const updateUserStatusSchema = z.object({
  status: z.enum(["ACTIVE", "SUSPENDED", "BANNED"]),
  reason: z.string().trim().max(500).optional(),
});

export const idParamSchema = z.object({ id: z.string().uuid() });

export type AdminUserListQuery = z.infer<typeof adminUserListQuerySchema>;
