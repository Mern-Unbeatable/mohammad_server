import { Router } from "express";
import { validate } from "@/middleware/validate";
import { authenticate } from "@/middleware/authenticate";
import { authRateLimiter } from "@/middleware/rateLimit";
import { authController } from "./auth.controller";
import { loginSchema, refreshSchema, registerSchema } from "./auth.validators";

const router = Router();

router.post(
  "/register",
  authRateLimiter,
  validate({ body: registerSchema }),
  authController.register,
);
router.post(
  "/login",
  authRateLimiter,
  validate({ body: loginSchema }),
  authController.login,
);
router.post(
  "/refresh",
  validate({ body: refreshSchema }),
  authController.refresh,
);
router.post(
  "/logout",
  validate({ body: refreshSchema }),
  authController.logout,
);
router.get("/me", authenticate, authController.me);

export const authRoutes = router;
