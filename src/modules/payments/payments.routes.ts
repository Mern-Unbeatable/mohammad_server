import { Router } from "express";
import { Role } from "@prisma/client";
import { authenticate } from "@/middleware/authenticate";
import { authorize } from "@/middleware/authorize";
import { validate } from "@/middleware/validate";
import { paymentsController } from "./payments.controller";
import {
  adminPaymentsQuerySchema,
  myPaymentsQuerySchema,
  paymentIdParamSchema,
} from "./payments.validators";

/** Mounted at /payments — any signed-in member (user or supplier). */
const memberRouter = Router();
memberRouter.use(authenticate);
memberRouter.get(
  "/me",
  validate({ query: myPaymentsQuerySchema }),
  paymentsController.listMine,
);
// Owner or admin; the service enforces ownership.
memberRouter.get(
  "/:id/links",
  validate({ params: paymentIdParamSchema }),
  paymentsController.links,
);

/** Mounted at /admin/payments (behind the admin router's authenticate + active check). */
const adminRouter = Router();
adminRouter.use(authenticate, authorize(Role.ADMIN));
adminRouter.get(
  "/",
  validate({ query: adminPaymentsQuerySchema }),
  paymentsController.listAll,
);
adminRouter.post("/sync", paymentsController.syncAll);

export const paymentsRoutes = memberRouter;
export const adminPaymentsRoutes = adminRouter;
