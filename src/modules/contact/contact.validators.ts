import { z } from "zod";

export const INQUIRY_TYPES = [
  "general",
  "membership",
  "partnership",
  "technical",
] as const;

export const INQUIRY_LABELS: Record<(typeof INQUIRY_TYPES)[number], string> = {
  general: "General",
  membership: "Membership",
  partnership: "Partnership",
  technical: "Technical",
};

/** Header-bound fields reject line breaks so they cannot inject mail headers. */
const singleLine = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((value) => !/[\r\n]/.test(value), "Must be a single line");

export const contactMessageSchema = z.object({
  fullName: singleLine(120).pipe(z.string().min(1, "Full name is required")),
  email: z.string().trim().toLowerCase().email().max(254),
  phone: singleLine(40).optional(),
  company: singleLine(160).optional(),
  inquiryType: z.enum(INQUIRY_TYPES),
  message: z.string().trim().min(10, "Message must be at least 10 characters").max(5000),
});

export type ContactMessageInput = z.infer<typeof contactMessageSchema>;
