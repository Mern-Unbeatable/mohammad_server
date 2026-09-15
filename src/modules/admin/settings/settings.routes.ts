import { Router } from "express";
import { Role } from "@prisma/client";
import { authenticate } from "@/middleware/authenticate";
import { authorize } from "@/middleware/authorize";
import { validate } from "@/middleware/validate";
import { settingsController } from "./settings.controller";
import {
  settingKeyParamSchema,
  updateSettingSchema,
} from "./settings.validators";

const router = Router();

router.use(authenticate, authorize(Role.ADMIN));

router.get("/", settingsController.getSettings);
router.get(
  "/:key",
  validate({ params: settingKeyParamSchema }),
  settingsController.getSetting,
);
router.put(
  "/:key",
  validate({ params: settingKeyParamSchema, body: updateSettingSchema }),
  settingsController.upsertSetting,
);

export const settingsRoutes = router;
