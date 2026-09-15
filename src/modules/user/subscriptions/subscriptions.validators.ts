import { z } from "zod";

export const subscribeSchema = z.object({
  plan: z.enum(["MONTHLY", "YEARLY"]),
  paymentMethod: z.string().trim().max(120).optional(),
});
