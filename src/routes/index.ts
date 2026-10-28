import { Router } from "express";
import { authRoutes } from "@/modules/auth/auth.routes";
import { routes as profileRoutes } from "@/modules/user/profile";
import { routes as adminUsersRoutes } from "@/modules/admin/users";
import { routes as contactsRoutes } from "@/modules/supplier/contacts";
import { routes as feedRoutes } from "@/modules/user/feed";
import { routes as marketplaceRoutes } from "@/modules/user/marketplace";
import { routes as recruitmentRoutes } from "@/modules/user/recruitment";
import { routes as generalRoutes } from "@/modules/user/general";
import { routes as blogsRoutes } from "@/modules/admin/blogs";
import { routes as messagesRoutes } from "@/modules/user/messages";
import { routes as notificationsRoutes } from "@/modules/supplier/notifications";
import { routes as advertisementsRoutes } from "@/modules/supplier/advertisements";
import { routes as reportsRoutes } from "@/modules/admin/reports";
import { routes as searchRoutes } from "@/modules/user/search";
import { routes as subscriptionsRoutes } from "@/modules/user/subscriptions";
import { routes as adminRoutes } from "@/modules/admin";
import { uploadsRoutes } from "@/modules/uploads/uploads.routes";
import { routes as contactRoutes } from "@/modules/contact";

export const apiRouter = Router();

/** Compose /users from profile (/me*) + admin user management. */
const usersRoutes = Router();
usersRoutes.use(profileRoutes);
usersRoutes.use(adminUsersRoutes);

apiRouter.get("/", (_req, res) => {
  const environment = process.env.NODE_ENV ?? "development";

  res.json({
    success: true,
    api: {
      version: "v1",
      status: "operational",
      basePath: "/api/v1",
      health: "/api/v1/health",
    },
    environment,
    uptime: Number(process.uptime().toFixed(2)),
  });
});

apiRouter.get("/health", (_req, res) => {
  res.json({
    success: true,
    data: {
      status: "ok",
      uptime: Number(process.uptime().toFixed(2)),
      environment: process.env.NODE_ENV ?? "development",
      timestamp: new Date().toISOString(),
    },
  });
});

apiRouter.use("/auth", authRoutes);
apiRouter.use("/users", usersRoutes);
apiRouter.use("/contacts", contactsRoutes);
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
apiRouter.use("/search", searchRoutes);
apiRouter.use("/admin", adminRoutes);
apiRouter.use("/uploads", uploadsRoutes);
apiRouter.use("/contact", contactRoutes);
