import { Router } from "express";
import { validate } from "@/middleware/validate";
import { authenticate } from "@/middleware/authenticate";
import { authRateLimiter } from "@/middleware/rateLimit";
import { authController } from "./auth.controller";
import {
  forgotPasswordSchema,
  loginSchema,
  refreshSchema,
  registerSchema,
  resetPasswordSchema,
  verifyResetTokenSchema,
} from "./auth.validators";

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
router.post(
  "/forgot-password",
  authRateLimiter,
  validate({ body: forgotPasswordSchema }),
  authController.forgotPassword,
);
// POST with the token in the body so it never appears in request-URL logs.
router.post(
  "/reset-password/verify",
  authRateLimiter,
  validate({ body: verifyResetTokenSchema }),
  authController.verifyResetToken,
);
router.post(
  "/reset-password",
  authRateLimiter,
  validate({ body: resetPasswordSchema }),
  authController.resetPassword,
);
router.get("/me", authenticate, authController.me);

export const authRoutes = router;
