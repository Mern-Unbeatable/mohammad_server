import { Router } from "express";
import { authenticate } from "@/middleware/authenticate";
import { requireActiveUser } from "@/middleware/requireActiveUser";
import { chatSendRateLimiter, uploadRateLimiter } from "@/middleware/rateLimit";
import { validate } from "@/middleware/validate";
import { chatAttachmentUploadRoutes } from "@/shared/chat/attachmentRoutes";
import { messagesController } from "./messages.controller";
import {
  addParticipantsSchema,
  conversationIdParamSchema,
  conversationListQuerySchema,
  createGroupSchema,
  directUserParamSchema,
  editMessageSchema,
  messageIdParamSchema,
  messageListQuerySchema,
  participantParamSchema,
  recipientsQuerySchema,
  renameGroupSchema,
  sendMessageSchema,
  startDirectSchema,
} from "./messages.validators";

const router = Router();

router.use(authenticate, requireActiveUser);

router.use("/attachments", uploadRateLimiter, chatAttachmentUploadRoutes);

router.get(
  "/",
  validate({ query: conversationListQuerySchema }),
  messagesController.listConversations,
);
// Static paths must stay above "/:id" routes.
router.get(
  "/recipients",
  validate({ query: recipientsQuerySchema }),
  messagesController.listRecipients,
);
router.get("/unread", messagesController.unreadSummary);
router.get(
  "/direct/:userId",
  validate({ params: directUserParamSchema }),
  messagesController.findDirect,
);
router.post(
  "/direct",
  chatSendRateLimiter,
  validate({ body: startDirectSchema }),
  messagesController.startDirect,
);
router.post(
  "/group",
  chatSendRateLimiter,
  validate({ body: createGroupSchema }),
  messagesController.createGroup,
);
router.get(
  "/:id",
  validate({ params: conversationIdParamSchema }),
  messagesController.getConversation,
);
router.patch(
  "/:id",
  validate({ params: conversationIdParamSchema, body: renameGroupSchema }),
  messagesController.renameGroup,
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
  chatSendRateLimiter,
  validate({ params: conversationIdParamSchema, body: sendMessageSchema }),
  messagesController.sendMessage,
);
router.patch(
  "/:id/messages/:messageId",
  validate({ params: messageIdParamSchema, body: editMessageSchema }),
  messagesController.editMessage,
);
router.delete(
  "/:id/messages/:messageId",
  validate({ params: messageIdParamSchema }),
  messagesController.deleteMessage,
);
router.post(
  "/:id/read",
  validate({ params: conversationIdParamSchema }),
  messagesController.markRead,
);
router.post(
  "/:id/participants",
  validate({ params: conversationIdParamSchema, body: addParticipantsSchema }),
  messagesController.addParticipants,
);
router.delete(
  "/:id/participants/:userId",
  validate({ params: participantParamSchema }),
  messagesController.removeParticipant,
);
router.delete(
  "/:id/leave",
  validate({ params: conversationIdParamSchema }),
  messagesController.leave,
);

export const messagesRoutes = router;
