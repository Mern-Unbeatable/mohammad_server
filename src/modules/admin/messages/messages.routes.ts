import { Router } from "express";
import { Role } from "@prisma/client";
import { authenticate } from "@/middleware/authenticate";
import { authorize } from "@/middleware/authorize";
import { validate } from "@/middleware/validate";
import { adminMessagesController } from "./messages.controller";
import {
  adminConversationIdParamSchema,
  adminConversationListQuerySchema,
  adminMessageIdParamSchema,
  adminMessageListQuerySchema,
} from "./messages.validators";

const router = Router();

router.use(authenticate, authorize(Role.ADMIN));

router.get(
  "/",
  validate({ query: adminConversationListQuerySchema }),
  adminMessagesController.listConversations,
);
router.get(
  "/:id",
  validate({ params: adminConversationIdParamSchema }),
  adminMessagesController.getConversation,
);
router.get(
  "/:id/messages",
  validate({
    params: adminConversationIdParamSchema,
    query: adminMessageListQuerySchema,
  }),
  adminMessagesController.getMessages,
);
router.delete(
  "/:id/messages/:messageId",
  validate({ params: adminMessageIdParamSchema }),
  adminMessagesController.deleteMessage,
);
router.delete(
  "/:id",
  validate({ params: adminConversationIdParamSchema }),
  adminMessagesController.deleteConversation,
);

export const adminMessagesRoutes = router;
