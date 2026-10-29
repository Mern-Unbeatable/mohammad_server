import { Router } from "express";
import { authenticate } from "@/middleware/authenticate";
import { requireEntitlement } from "@/middleware/requireEntitlement";
import { validate } from "@/middleware/validate";
import { generalController } from "./general.controller";
import {
  createGeneralPostSchema,
  generalIdParamSchema,
  generalListQuerySchema,
  updateGeneralPostSchema,
} from "./general.validators";

const router = Router();

router.use(authenticate, requireEntitlement);

router.get(
  "/",
  validate({ query: generalListQuerySchema }),
  generalController.list,
);
router.post(
  "/",
  validate({ body: createGeneralPostSchema }),
  generalController.create,
);
router.get(
  "/:id",
  validate({ params: generalIdParamSchema }),
  generalController.getById,
);
router.patch(
  "/:id",
  validate({ params: generalIdParamSchema, body: updateGeneralPostSchema }),
  generalController.update,
);
router.delete(
  "/:id",
  validate({ params: generalIdParamSchema }),
  generalController.remove,
);

export const generalRoutes = router;
