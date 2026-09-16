import { Router } from "express";
import { authenticate } from "@/middleware/authenticate";
import { validate } from "@/middleware/validate";
import { messagesController } from "./messages.controller";
import {
  conversationIdParamSchema,
  conversationListQuerySchema,
  createGroupSchema,
  messageIdParamSchema,
  messageListQuerySchema,
  sendMessageSchema,
  startDirectSchema,
} from "./messages.validators";

const router = Router();

router.use(authenticate);

router.get(
  "/",
  validate({ query: conversationListQuerySchema }),
  messagesController.listConversations,
);
router.post(
  "/direct",
  validate({ body: startDirectSchema }),
  messagesController.startDirect,
);
router.post(
  "/group",
  validate({ body: createGroupSchema }),
  messagesController.createGroup,
);
router.get(
  "/:id/messages",
  validate({
    params: conversationIdParamSchema,
    query: messageListQuerySchema,
  }),
  messagesController.getMessages,
);
router.post(
  "/:id/messages",
  validate({ params: conversationIdParamSchema, body: sendMessageSchema }),
  messagesController.sendMessage,
);
router.delete(
  "/:id/messages/:messageId",
  validate({ params: messageIdParamSchema }),
  messagesController.deleteMessage,
);
router.delete(
  "/:id/leave",
  validate({ params: conversationIdParamSchema }),
  messagesController.leave,
);

export const messagesRoutes = router;
