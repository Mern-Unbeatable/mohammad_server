import { Router } from "express";
import { Role } from "@prisma/client";
import { authenticate } from "@/middleware/authenticate";
import { authorize } from "@/middleware/authorize";
import { validate } from "@/middleware/validate";
import { adminController } from "./admin.controller";
import {
  settingKeyParamSchema,
  statisticsQuerySchema,
  updateSettingSchema,
} from "./admin.validators";

const router = Router();

router.use(authenticate, authorize(Role.ADMIN));

router.get("/dashboard", adminController.dashboard);
router.get(
  "/statistics",
  validate({ query: statisticsQuerySchema }),
  adminController.statistics,
);

router.get("/settings", adminController.getSettings);
router.get(
  "/settings/:key",
  validate({ params: settingKeyParamSchema }),
  adminController.getSetting,
);
router.put(
  "/settings/:key",
  validate({ params: settingKeyParamSchema, body: updateSettingSchema }),
  adminController.upsertSetting,
);

export const adminRoutes = router;
