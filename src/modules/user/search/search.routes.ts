import { Router } from "express";
import { authenticate } from "@/middleware/authenticate";
import { requireEntitlement } from "@/middleware/requireEntitlement";
import { validate } from "@/middleware/validate";
import { searchController } from "./search.controller";
import { searchQuerySchema } from "./search.validators";

const router = Router();

router.use(authenticate, requireEntitlement);

router.get("/", validate({ query: searchQuerySchema }), searchController.search);

export const searchRoutes = router;
