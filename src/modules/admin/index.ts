import { Router } from "express";
import { authenticate } from "@/middleware/authenticate";
import { requireActiveUser } from "@/middleware/requireActiveUser";
import { routes as dashboardRoutes } from "./dashboard";
import { routes as statisticsRoutes } from "./statistics";
import { routes as settingsRoutes } from "./settings";
import { routes as messagesRoutes } from "./messages";
import { adminPaymentsRoutes } from "@/modules/payments";

const router = Router();

// Suspended or banned admins lose /admin access immediately, even with a valid access token.
router.use(authenticate, requireActiveUser);

router.use("/dashboard", dashboardRoutes);
router.use("/statistics", statisticsRoutes);
router.use("/settings", settingsRoutes);
router.use("/messages", messagesRoutes);
router.use("/payments", adminPaymentsRoutes);

export const adminRoutes = router;
export { adminRoutes as routes };
