import { Router } from "express";
import { Role } from "@prisma/client";
import { authenticate } from "@/middleware/authenticate";
import { authorize } from "@/middleware/authorize";
import { validate } from "@/middleware/validate";
import { adTrackRateLimiter } from "@/middleware/rateLimit";
import { advertisementsController } from "./advertisements.controller";
import {
  adIdParamSchema,
  adListQuerySchema,
  confirmAdCheckoutSchema,
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
  "/:id/cta",
  adTrackRateLimiter,
  validate({ params: adIdParamSchema }),
  advertisementsController.cta,
);
router.post(
  "/:id/track/:metric",
  adTrackRateLimiter,
  validate({ params: adIdParamSchema }),
  advertisementsController.track,
);

router.get(
  "/pricing",
  authorize(Role.SUPPLIER, Role.ADMIN),
  advertisementsController.pricing,
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

// Supplier payment (Stripe one-time Checkout) + cancel
router.post(
  "/:id/checkout",
  authorize(Role.SUPPLIER),
  validate({ params: adIdParamSchema }),
  advertisementsController.startCheckout,
);
router.post(
  "/:id/checkout/confirm",
  authorize(Role.SUPPLIER),
  validate({ params: adIdParamSchema, body: confirmAdCheckoutSchema }),
  advertisementsController.confirmCheckout,
);
router.patch(
  "/:id/cancel",
  authorize(Role.SUPPLIER),
  validate({ params: adIdParamSchema }),
  advertisementsController.cancel,
);

// Admin approval workflow
router.patch(
  "/:id/review",
  authorize(Role.ADMIN),
  validate({ params: adIdParamSchema, body: reviewAdSchema }),
  advertisementsController.review,
);

export const advertisementsRoutes = router;
