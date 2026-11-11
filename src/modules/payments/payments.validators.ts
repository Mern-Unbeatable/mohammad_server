import { z } from "zod";
import { paginationQuerySchema } from "@/shared/http/pagination";

const kindSchema = z.enum(["subscription", "advertisement", "other"]);
const statusSchema = z.enum(["paid", "open", "failed", "void", "uncollectible"]);

/** GET /payments/me */
export const myPaymentsQuerySchema = paginationQuerySchema
  .pick({ page: true, pageSize: true })
  .extend({ kind: kindSchema.optional() });

/** GET /admin/payments */
export const adminPaymentsQuerySchema = paginationQuerySchema.extend({
  kind: kindSchema.optional(),
  status: statusSchema.optional(),
  userId: z.string().uuid().optional(),
});

export const paymentIdParamSchema = z.object({ id: z.string().uuid() });

export type MyPaymentsQuery = z.infer<typeof myPaymentsQuerySchema>;
export type AdminPaymentsQuery = z.infer<typeof adminPaymentsQuerySchema>;
