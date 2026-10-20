import { Request, Response } from "express";
import { sendSuccess } from "@/shared/http/apiResponse";
import { asyncHandler } from "@/shared/utils/asyncHandler";
import { adminMessagesService } from "./messages.service";

export const adminMessagesController = {
  listConversations: asyncHandler(async (req: Request, res: Response) => {
    const result = await adminMessagesService.listConversations(
      req.query as never,
    );
    sendSuccess(res, { data: result.data, meta: result.meta });
  }),

  getConversation: asyncHandler(async (req: Request, res: Response) => {
    const data = await adminMessagesService.getConversation(req.params.id);
    sendSuccess(res, { data });
  }),

  getMessages: asyncHandler(async (req: Request, res: Response) => {
    const result = await adminMessagesService.getMessages(
      req.user!.id,
      req.params.id,
      req.query as never,
    );
    sendSuccess(res, { data: result.data, meta: result.meta });
  }),

  deleteMessage: asyncHandler(async (req: Request, res: Response) => {
    const data = await adminMessagesService.deleteMessage(
      req.params.id,
      req.params.messageId,
      req.user!.id,
    );
    sendSuccess(res, { data });
  }),

  deleteConversation: asyncHandler(async (req: Request, res: Response) => {
    const data = await adminMessagesService.deleteConversation(req.params.id, req.user!.id);
    sendSuccess(res, { data });
  }),
};
