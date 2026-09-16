import { Router } from "express";
import { authenticate } from "@/middleware/authenticate";
import { validate } from "@/middleware/validate";
import { subscriptionsController } from "./subscriptions.controller";
import {
  confirmCheckoutSchema,
  subscribeSchema,
} from "./subscriptions.validators";

const router = Router();

router.get("/plans", subscriptionsController.getPlans);

router.use(authenticate);
router.get("/me", subscriptionsController.getMine);
router.post(
  "/subscribe",
  validate({ body: subscribeSchema }),
  subscriptionsController.subscribe,
);
router.post(
  "/confirm-checkout",
  validate({ body: confirmCheckoutSchema }),
  subscriptionsController.confirmCheckout,
);
router.post("/cancel", subscriptionsController.cancel);

export const subscriptionsRoutes = router;
