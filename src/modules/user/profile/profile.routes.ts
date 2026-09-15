import { Router } from "express";
import { authenticate } from "@/middleware/authenticate";
import { validate } from "@/middleware/validate";
import { profileController } from "./profile.controller";
import {
  changePasswordSchema,
  updateProfileSchema,
} from "./profile.validators";

const router = Router();

router.use(authenticate);

router.get("/me", profileController.getMe);
router.patch(
  "/me",
  validate({ body: updateProfileSchema }),
  profileController.updateProfile,
);
router.patch(
  "/me/password",
  validate({ body: changePasswordSchema }),
  profileController.changePassword,
);

export const profileRoutes = router;
