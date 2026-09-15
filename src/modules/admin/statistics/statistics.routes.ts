import { Router } from "express";
import { Role } from "@prisma/client";
import { authenticate } from "@/middleware/authenticate";
import { authorize } from "@/middleware/authorize";
import { validate } from "@/middleware/validate";
import { statisticsController } from "./statistics.controller";
import { statisticsQuerySchema } from "./statistics.validators";

const router = Router();

router.use(authenticate, authorize(Role.ADMIN));
router.get(
  "/",
  validate({ query: statisticsQuerySchema }),
  statisticsController.statistics,
);

export const statisticsRoutes = router;
