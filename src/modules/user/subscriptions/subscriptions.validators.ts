import { z } from "zod";

export const subscribeSchema = z.object({
  plan: z.enum(["MONTHLY", "YEARLY"]),
});

export const confirmCheckoutSchema = z.object({
  sessionId: z.string().trim().min(1).max(200),
});
