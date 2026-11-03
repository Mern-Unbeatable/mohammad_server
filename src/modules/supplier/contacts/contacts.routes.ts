import { Router } from "express";
import { authenticate } from "@/middleware/authenticate";
import { requireEntitlement } from "@/middleware/requireEntitlement";
import { validate } from "@/middleware/validate";
import { contactsController } from "./contacts.controller";
import {
  connectionIdParamSchema,
  connectionRequestSchema,
  contactListQuerySchema,
} from "./contacts.validators";

const router = Router();

router.use(authenticate, requireEntitlement);

router.get(
  "/",
  validate({ query: contactListQuerySchema }),
  contactsController.listContacts,
);
router.get(
  "/:id",
  validate({ params: connectionIdParamSchema }),
  contactsController.getContact,
);
router.post(
  "/request",
  validate({ body: connectionRequestSchema }),
  contactsController.request,
);
router.patch(
  "/:id/accept",
  validate({ params: connectionIdParamSchema }),
  contactsController.accept,
);
router.patch(
  "/:id/decline",
  validate({ params: connectionIdParamSchema }),
  contactsController.decline,
);
router.delete(
  "/:id",
  validate({ params: connectionIdParamSchema }),
  contactsController.remove,
);

export const contactsRoutes = router;
