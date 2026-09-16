import { Router } from "express";
import { Role } from "@prisma/client";
import { authenticate } from "@/middleware/authenticate";
import { authorize } from "@/middleware/authorize";
import { validate } from "@/middleware/validate";
import { reportsController } from "./reports.controller";
import {
  createReportSchema,
  moderateSchema,
  reportIdParamSchema,
  reportListQuerySchema,
  updateReportStatusSchema,
} from "./reports.validators";

const router = Router();

router.use(authenticate);

// Any authenticated user can file a report
router.post(
  "/",
  validate({ body: createReportSchema }),
  reportsController.create,
);

// Reporter's own submissions (before /:id)
router.get(
  "/me",
  validate({ query: reportListQuerySchema }),
  reportsController.listMine,
);

// Admin moderation surface
router.get(
  "/",
  authorize(Role.ADMIN),
  validate({ query: reportListQuerySchema }),
  reportsController.list,
);
router.get("/stats", authorize(Role.ADMIN), reportsController.stats);
router.get(
  "/:id",
  authorize(Role.ADMIN),
  validate({ params: reportIdParamSchema }),
  reportsController.getById,
);
router.patch(
  "/:id/status",
  authorize(Role.ADMIN),
  validate({ params: reportIdParamSchema, body: updateReportStatusSchema }),
  reportsController.updateStatus,
);
router.post(
  "/:id/moderate",
  authorize(Role.ADMIN),
  validate({ params: reportIdParamSchema, body: moderateSchema }),
  reportsController.moderate,
);

export const reportsRoutes = router;
