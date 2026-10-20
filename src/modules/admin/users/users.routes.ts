import { Router } from "express";
import { Role } from "@prisma/client";
import { authenticate } from "@/middleware/authenticate";
import { authorize } from "@/middleware/authorize";
import { requireActiveUser } from "@/middleware/requireActiveUser";
import { validate } from "@/middleware/validate";
import { usersController } from "./users.controller";
import {
  adminUserListQuerySchema,
  idParamSchema,
  updateUserStatusSchema,
} from "./users.validators";

const router = Router();

router.use(authenticate);

/** Admin-only routes also require an ACTIVE account (a suspended admin cannot reactivate themselves). */
const activeAdmin = [authorize(Role.ADMIN), requireActiveUser];

router.get(
  "/",
  ...activeAdmin,
  validate({ query: adminUserListQuerySchema }),
  usersController.list,
);
// Any authenticated user may view an ACTIVE member's public profile;
// ADMIN receives the full admin payload.
router.get(
  "/:id",
  validate({ params: idParamSchema }),
  usersController.getById,
);
router.get(
  "/:id/content",
  ...activeAdmin,
  validate({ params: idParamSchema }),
  usersController.getContent,
);
router.patch(
  "/:id/status",
  ...activeAdmin,
  validate({ params: idParamSchema, body: updateUserStatusSchema }),
  usersController.updateStatus,
);

export const usersRoutes = router;
