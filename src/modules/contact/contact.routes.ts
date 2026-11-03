import { Router } from "express";
import { validate } from "@/middleware/validate";
import { contactRateLimiter } from "@/middleware/rateLimit";
import { contactController } from "./contact.controller";
import { contactMessageSchema } from "./contact.validators";

const router = Router();

router.post(
  "/",
  contactRateLimiter,
  validate({ body: contactMessageSchema }),
  contactController.send,
);

export const contactRoutes = router;
