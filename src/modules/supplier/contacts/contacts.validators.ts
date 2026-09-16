import { z } from "zod";
import { paginationQuerySchema } from "@/shared/http/pagination";

export const contactListQuerySchema = paginationQuerySchema.extend({
  country: z.string().trim().max(80).optional(),
  /** Filter by connection relationship with the caller. */
  status: z.enum(["pending", "accepted", "declined"]).optional(),
  /** With status=pending: incoming = requests to me, outgoing = requests I sent. */
  direction: z.enum(["incoming", "outgoing"]).optional(),
});

export const connectionRequestSchema = z.object({
  addresseeId: z.string().uuid(),
});

export const connectionIdParamSchema = z.object({ id: z.string().uuid() });

export type ContactListQuery = z.infer<typeof contactListQuerySchema>;
