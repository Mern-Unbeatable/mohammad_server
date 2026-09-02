import { Router } from "express";
import { authenticate } from "@/middleware/authenticate";
import { validate } from "@/middleware/validate";
import { notificationsController } from "./notifications.controller";
import {
  notificationIdParamSchema,
  notificationListQuerySchema,
} from "./notifications.validators";

const router = Router();

router.use(authenticate);

router.get(
  "/",
  validate({ query: notificationListQuerySchema }),
  notificationsController.list,
);
router.patch("/read-all", notificationsController.markAllRead);
router.patch(
  "/:id/read",
  validate({ params: notificationIdParamSchema }),
  notificationsController.markRead,
);
router.delete(
  "/:id",
  validate({ params: notificationIdParamSchema }),
  notificationsController.remove,
);

export const notificationsRoutes = router;
