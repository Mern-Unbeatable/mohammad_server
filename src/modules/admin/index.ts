import { Router } from "express";
import { routes as dashboardRoutes } from "./dashboard";
import { routes as statisticsRoutes } from "./statistics";
import { routes as settingsRoutes } from "./settings";
import { routes as messagesRoutes } from "./messages";

const router = Router();

router.use("/dashboard", dashboardRoutes);
router.use("/statistics", statisticsRoutes);
router.use("/settings", settingsRoutes);
router.use("/messages", messagesRoutes);

export const adminRoutes = router;
export { adminRoutes as routes };
