import { z } from "zod";

export const updateProfileSchema = z.object({
  firstName: z.string().trim().min(1).max(80).optional(),
  // Empty is allowed so single-word display names (e.g. "Admin") are not doubled.
  lastName: z.string().trim().max(80).optional(),
  title: z.string().trim().max(120).optional(),
  company: z.string().trim().max(160).optional(),
  country: z.string().trim().max(80).optional(),
  // Stored as Profile.location ("City, Country"), composed with `country` on save.
  city: z.string().trim().max(80).optional(),
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

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
