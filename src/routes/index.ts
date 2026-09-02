import { Router } from "express";
import { authRoutes } from "@/modules/auth/auth.routes";
import { usersRoutes } from "@/modules/users/users.routes";
import { connectionsRoutes } from "@/modules/connections/connections.routes";
import { feedRoutes } from "@/modules/feed/feed.routes";
import { marketplaceRoutes } from "@/modules/marketplace/marketplace.routes";
import { recruitmentRoutes } from "@/modules/recruitment/recruitment.routes";
import { generalRoutes } from "@/modules/general/general.routes";
import { blogsRoutes } from "@/modules/blogs/blogs.routes";
import { messagesRoutes } from "@/modules/messages/messages.routes";
import { notificationsRoutes } from "@/modules/notifications/notifications.routes";
import { advertisementsRoutes } from "@/modules/advertisements/advertisements.routes";
import { reportsRoutes } from "@/modules/reports/reports.routes";
import { subscriptionsRoutes } from "@/modules/subscriptions/subscriptions.routes";
import { adminRoutes } from "@/modules/admin/admin.routes";
import { uploadsRoutes } from "@/modules/uploads/uploads.routes";

export const apiRouter = Router();

apiRouter.get("/health", (_req, res) => {
  res.json({ success: true, data: { status: "ok", uptime: process.uptime() } });
});

apiRouter.use("/auth", authRoutes);
apiRouter.use("/users", usersRoutes);
apiRouter.use("/contacts", connectionsRoutes);
apiRouter.use("/feed", feedRoutes);
apiRouter.use("/marketplace", marketplaceRoutes);
apiRouter.use("/recruitment", recruitmentRoutes);
apiRouter.use("/general", generalRoutes);
apiRouter.use("/blogs", blogsRoutes);
apiRouter.use("/messages", messagesRoutes);
apiRouter.use("/notifications", notificationsRoutes);
apiRouter.use("/advertisements", advertisementsRoutes);
apiRouter.use("/reports", reportsRoutes);
apiRouter.use("/subscriptions", subscriptionsRoutes);
apiRouter.use("/admin", adminRoutes);
apiRouter.use("/uploads", uploadsRoutes);
