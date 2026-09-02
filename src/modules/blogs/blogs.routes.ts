import { Router } from "express";
import { Role } from "@prisma/client";
import { authenticate, optionalAuthenticate } from "@/middleware/authenticate";
import { authorize } from "@/middleware/authorize";
import { validate } from "@/middleware/validate";
import { blogsController } from "./blogs.controller";
import {
  blogIdParamSchema,
  blogListQuerySchema,
  blogSlugParamSchema,
  createBlogSchema,
  updateBlogSchema,
} from "./blogs.validators";

const router = Router();

// Public reads (blogs surface on the marketing site and to all roles)
router.get(
  "/",
  optionalAuthenticate,
  validate({ query: blogListQuerySchema }),
  blogsController.list,
);
router.get(
  "/:slug",
  validate({ params: blogSlugParamSchema }),
  blogsController.getBySlug,
);

// Admin management
router.post(
  "/",
  authenticate,
  authorize(Role.ADMIN),
  validate({ body: createBlogSchema }),
  blogsController.create,
);
router.patch(
  "/:id",
  authenticate,
  authorize(Role.ADMIN),
  validate({ params: blogIdParamSchema, body: updateBlogSchema }),
  blogsController.update,
);
router.delete(
  "/:id",
  authenticate,
  authorize(Role.ADMIN),
  validate({ params: blogIdParamSchema }),
  blogsController.remove,
);

export const blogsRoutes = router;
