import { z } from "zod";
import { paginationQuerySchema } from "@/shared/http/pagination";

export const updateProfileSchema = z.object({
  firstName: z.string().trim().min(1).max(80).optional(),
  lastName: z.string().trim().min(1).max(80).optional(),
  title: z.string().trim().max(120).optional(),
  company: z.string().trim().max(160).optional(),
  country: z.string().trim().max(80).optional(),
  location: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(40).optional(),
  about: z.string().trim().max(4000).optional(),
  aboutExtended: z.string().trim().max(8000).optional(),
  avatarUrl: z.string().url().optional(),
  coverUrl: z.string().url().optional(),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: z
      .string()
      .min(8)
      .regex(/[A-Z]/, "Password must contain an uppercase letter")
      .regex(/\d/, "Password must contain a number")
      .regex(/[^A-Za-z0-9]/, "Password must contain a symbol"),
    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

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

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type AdminUserListQuery = z.infer<typeof adminUserListQuerySchema>;
