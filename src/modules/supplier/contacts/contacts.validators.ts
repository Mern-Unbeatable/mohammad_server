import { z } from "zod";
import { paginationQuerySchema } from "@/shared/http/pagination";

export const contactListQuerySchema = paginationQuerySchema.extend({
  country: z.string().trim().max(80).optional(),
});

export const connectionRequestSchema = z.object({
  addresseeId: z.string().uuid(),
});

export const connectionIdParamSchema = z.object({ id: z.string().uuid() });

export type ContactListQuery = z.infer<typeof contactListQuerySchema>;
