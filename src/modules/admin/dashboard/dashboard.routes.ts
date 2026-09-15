import { Router } from "express";
import { Role } from "@prisma/client";
import { authenticate } from "@/middleware/authenticate";
import { authorize } from "@/middleware/authorize";
import { dashboardController } from "./dashboard.controller";

const router = Router();

router.use(authenticate, authorize(Role.ADMIN));
router.get("/", dashboardController.dashboard);

export const dashboardRoutes = router;
