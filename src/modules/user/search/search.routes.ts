import { Router } from "express";
import { authenticate } from "@/middleware/authenticate";
import { validate } from "@/middleware/validate";
import { searchController } from "./search.controller";
import { searchQuerySchema } from "./search.validators";

const router = Router();

router.use(authenticate);

router.get("/", validate({ query: searchQuerySchema }), searchController.search);

export const searchRoutes = router;
