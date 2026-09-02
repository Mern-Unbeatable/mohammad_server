import { Router } from "express";
import { authenticate } from "@/middleware/authenticate";
import { validate } from "@/middleware/validate";
import { connectionsController } from "./connections.controller";
import {
  connectionIdParamSchema,
  connectionRequestSchema,
  contactListQuerySchema,
} from "./connections.validators";

const router = Router();

router.use(authenticate);

router.get(
  "/",
  validate({ query: contactListQuerySchema }),
  connectionsController.listContacts,
);
router.get(
  "/:id",
  validate({ params: connectionIdParamSchema }),
  connectionsController.getContact,
);
router.post(
  "/request",
  validate({ body: connectionRequestSchema }),
  connectionsController.request,
);
router.patch(
  "/:id/accept",
  validate({ params: connectionIdParamSchema }),
  connectionsController.accept,
);
router.patch(
  "/:id/decline",
  validate({ params: connectionIdParamSchema }),
  connectionsController.decline,
);
router.delete(
  "/:id",
  validate({ params: connectionIdParamSchema }),
  connectionsController.remove,
);

export const connectionsRoutes = router;
