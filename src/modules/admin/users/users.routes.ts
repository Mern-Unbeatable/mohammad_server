import { Router } from "express";
import { Role } from "@prisma/client";
import { authenticate } from "@/middleware/authenticate";
import { authorize } from "@/middleware/authorize";
import { validate } from "@/middleware/validate";
import { usersController } from "./users.controller";
import {
  adminUserListQuerySchema,
  idParamSchema,
  updateUserStatusSchema,
} from "./users.validators";

const router = Router();

router.use(authenticate);

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
