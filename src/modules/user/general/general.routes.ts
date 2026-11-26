import { Router } from "express";
import { authenticate, optionalAuthenticate } from "@/middleware/authenticate";
import { requireEntitlement } from "@/middleware/requireEntitlement";
import { validate } from "@/middleware/validate";
import { generalController } from "./general.controller";
import {
  clampGuestGeneralListQuery,
  enforceGuestGeneralViewLimit,
} from "./general.guestLimit";
import {
  createGeneralPostSchema,
  generalIdParamSchema,
  generalListQuerySchema,
  updateGeneralPostSchema,
} from "./general.validators";

const router = Router();

// Public / optional-auth reads (SEO + guest browsing). Mutations stay gated below.
router.get(
  "/",
  optionalAuthenticate,
  clampGuestGeneralListQuery,
  validate({ query: generalListQuerySchema }),
  generalController.list,
);
router.get(
  "/:id",
  optionalAuthenticate,
  validate({ params: generalIdParamSchema }),
  enforceGuestGeneralViewLimit,
  generalController.getById,
);

router.post(
  "/",
  authenticate,
  requireEntitlement,
  validate({ body: createGeneralPostSchema }),
  generalController.create,
);
router.patch(
  "/:id",
  authenticate,
  requireEntitlement,
  validate({ params: generalIdParamSchema, body: updateGeneralPostSchema }),
  generalController.update,
);
router.delete(
  "/:id",
  authenticate,
  requireEntitlement,
  validate({ params: generalIdParamSchema }),
  generalController.remove,
);

export const generalRoutes = router;
