import { Router } from "express";
import { Role } from "@prisma/client";
import { authenticate } from "@/middleware/authenticate";
import { authorize } from "@/middleware/authorize";
import { validate } from "@/middleware/validate";
import { usersController } from "./users.controller";
import {
  adminUserListQuerySchema,
  changePasswordSchema,
  idParamSchema,
  updateProfileSchema,
  updateUserStatusSchema,
} from "./users.validators";

const router = Router();

router.use(authenticate);

// Current-user profile
router.get("/me", usersController.getMe);
router.patch(
  "/me",
  validate({ body: updateProfileSchema }),
  usersController.updateProfile,
);
router.patch(
  "/me/password",
  validate({ body: changePasswordSchema }),
  usersController.changePassword,
);

// Admin user management
router.get(
  "/",
  authorize(Role.ADMIN),
  validate({ query: adminUserListQuerySchema }),
  usersController.list,
);
router.get(
  "/:id",
  authorize(Role.ADMIN),
  validate({ params: idParamSchema }),
  usersController.getById,
);
router.patch(
  "/:id/status",
  authorize(Role.ADMIN),
  validate({ params: idParamSchema, body: updateUserStatusSchema }),
  usersController.updateStatus,
);

export const usersRoutes = router;
