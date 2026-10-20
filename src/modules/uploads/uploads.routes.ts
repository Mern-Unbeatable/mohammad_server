import { Router } from "express";
import { authenticate } from "@/middleware/authenticate";
import { requireActiveUser } from "@/middleware/requireActiveUser";
import { uploadRateLimiter } from "@/middleware/rateLimit";
import { upload } from "@/middleware/upload";
import { uploadsController } from "./uploads.controller";

const router = Router();

router.use(authenticate, requireActiveUser, uploadRateLimiter);

router.post("/", ...upload.single("file"), uploadsController.single);
router.post("/multiple", ...upload.array("files", 12), uploadsController.multiple);

export const uploadsRoutes = router;
