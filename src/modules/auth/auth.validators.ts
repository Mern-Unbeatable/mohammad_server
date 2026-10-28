import { z } from "zod";

/**
 * Passwords must be at least 8 chars with an uppercase letter, a digit and a
 * symbol — mirroring the frontend registration strength meter.
 */
export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .regex(/[A-Z]/, "Password must contain an uppercase letter")
  .regex(/\d/, "Password must contain a number")
  .regex(/[^A-Za-z0-9]/, "Password must contain a symbol");

export const registerSchema = z
  .object({
    firstName: z.string().trim().min(1).max(80),
    lastName: z.string().trim().min(1).max(80),
    email: z.string().trim().toLowerCase().email(),
    password: passwordSchema,
    confirmPassword: z.string(),
    profileType: z
      .enum([
        "laboratory",
        "hospital",
        "clinic",
        "supplier",
        "professional",
        "other",
      ])
      .default("laboratory"),
    jobTitle: z.string().trim().max(120).optional(),
    company: z.string().trim().max(160).optional(),
    country: z.string().trim().max(80).optional(),
    city: z.string().trim().max(80).optional(),
    phone: z.string().trim().max(40).optional(),
    professionalInfo: z.string().trim().max(2000).optional(),
    acceptedTerms: z.literal(true, {
      errorMap: () => ({
        message: "You must accept the terms and privacy policy",
      }),
    }),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1, "Password is required"),
  remember: z.boolean().optional().default(true),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(10),
});

export const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
});

const resetTokenSchema = z.string().trim().min(32, "Invalid reset token").max(256);

export const verifyResetTokenSchema = z.object({
  token: resetTokenSchema,
});

export const resetPasswordSchema = z
  .object({
    token: resetTokenSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type VerifyResetTokenInput = z.infer<typeof verifyResetTokenSchema>;
