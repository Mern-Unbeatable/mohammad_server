import { Router } from "express";
import { Role } from "@prisma/client";
import { authenticate } from "@/middleware/authenticate";
import { authorize } from "@/middleware/authorize";
import { validate } from "@/middleware/validate";
import { advertisementsController } from "./advertisements.controller";
import {
  adIdParamSchema,
  adListQuerySchema,
  createAdSchema,
  reviewAdSchema,
  updateAdSchema,
} from "./advertisements.validators";

const router = Router();

router.use(authenticate);

// Public (authenticated) active ads feed + engagement tracking
router.get(
  "/active",
  validate({ query: adListQuerySchema }),
  advertisementsController.listActive,
);
router.post(
  "/:id/track/:metric",
  validate({ params: adIdParamSchema }),
  advertisementsController.track,
);

// Supplier-owned + admin listing
router.get(
  "/",
  validate({ query: adListQuerySchema }),
  advertisementsController.list,
);
router.post(
  "/",
  authorize(Role.SUPPLIER),
  validate({ body: createAdSchema }),
  advertisementsController.create,
);
router.get(
  "/:id",
  validate({ params: adIdParamSchema }),
  advertisementsController.getById,
);
router.patch(
  "/:id",
  authorize(Role.SUPPLIER),
  validate({ params: adIdParamSchema, body: updateAdSchema }),
  advertisementsController.update,
);
router.delete(
  "/:id",
  validate({ params: adIdParamSchema }),
  advertisementsController.remove,
);

// Admin approval workflow
router.patch(
  "/:id/review",
  authorize(Role.ADMIN),
  validate({ params: adIdParamSchema, body: reviewAdSchema }),
  advertisementsController.review,
);

export const advertisementsRoutes = router;
