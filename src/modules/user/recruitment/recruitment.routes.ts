import { Router } from "express";
import { authenticate } from "@/middleware/authenticate";
import { requireEntitlement } from "@/middleware/requireEntitlement";
import { validate } from "@/middleware/validate";
import { recruitmentController } from "./recruitment.controller";
import {
  applyJobSchema,
  createJobSchema,
  jobIdParamSchema,
  jobListQuerySchema,
  myApplicationsQuerySchema,
  updateJobSchema,
} from "./recruitment.validators";

const router = Router();

router.use(authenticate, requireEntitlement);

router.get(
  "/",
  validate({ query: jobListQuerySchema }),
  recruitmentController.list,
);
router.post(
  "/",
  validate({ body: createJobSchema }),
  recruitmentController.create,
);
// Must be registered before `/:id` so "applications" is not captured as an id.
router.get(
  "/applications/me",
  validate({ query: myApplicationsQuerySchema }),
  recruitmentController.listMyApplications,
);
router.get(
  "/applications/new-count",
  recruitmentController.newApplicationCounts,
);
router.get(
  "/:id",
  validate({ params: jobIdParamSchema }),
  recruitmentController.getById,
);
router.patch(
  "/:id",
  validate({ params: jobIdParamSchema, body: updateJobSchema }),
  recruitmentController.update,
);
router.delete(
  "/:id",
  validate({ params: jobIdParamSchema }),
  recruitmentController.remove,
);
router.post(
  "/:id/apply",
  validate({ params: jobIdParamSchema, body: applyJobSchema }),
  recruitmentController.apply,
);
router.delete(
  "/:id/apply",
  validate({ params: jobIdParamSchema }),
  recruitmentController.withdraw,
);
router.get(
  "/:id/applications",
  validate({ params: jobIdParamSchema }),
  recruitmentController.listApplications,
);

export const recruitmentRoutes = router;
