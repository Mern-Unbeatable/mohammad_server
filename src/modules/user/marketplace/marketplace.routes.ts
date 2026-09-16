import { Router } from "express";
import { authenticate } from "@/middleware/authenticate";
import { validate } from "@/middleware/validate";
import { marketplaceController } from "./marketplace.controller";
import {
  createListingSchema,
  enquireListingSchema,
  listingIdParamSchema,
  listingListQuerySchema,
  updateListingSchema,
} from "./marketplace.validators";

const router = Router();

router.use(authenticate);

router.get(
  "/",
  validate({ query: listingListQuerySchema }),
  marketplaceController.list,
);
router.post(
  "/",
  validate({ body: createListingSchema }),
  marketplaceController.create,
);
router.get(
  "/:id",
  validate({ params: listingIdParamSchema }),
  marketplaceController.getById,
);
router.patch(
  "/:id",
  validate({ params: listingIdParamSchema, body: updateListingSchema }),
  marketplaceController.update,
);
router.delete(
  "/:id",
  validate({ params: listingIdParamSchema }),
  marketplaceController.remove,
);
router.post(
  "/:id/save",
  validate({ params: listingIdParamSchema }),
  marketplaceController.toggleSave,
);
router.post(
  "/:id/enquire",
  validate({ params: listingIdParamSchema, body: enquireListingSchema }),
  marketplaceController.enquire,
);

export const marketplaceRoutes = router;
