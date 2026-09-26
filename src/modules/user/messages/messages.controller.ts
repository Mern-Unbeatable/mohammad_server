import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { sendSuccess } from "@/shared/http/apiResponse";
import { asyncHandler } from "@/shared/utils/asyncHandler";
import { messagesService } from "./messages.service";

export const messagesController = {
  listConversations: asyncHandler(async (req: Request, res: Response) => {
    const result = await messagesService.listConversations(
      req.user!.id,
      req.query as never,
    );
    sendSuccess(res, { data: result.data, meta: result.meta });
  }),

  listRecipients: asyncHandler(async (req: Request, res: Response) => {
    const result = await messagesService.listRecipients(
      { id: req.user!.id, role: req.user!.role },
      req.query as never,
    );
    sendSuccess(res, { data: result.data });
  }),

  getConversation: asyncHandler(async (req: Request, res: Response) => {
    const data = await messagesService.getConversation(
      req.user!.id,
      req.params.id,
    );
    sendSuccess(res, { data });
  }),

  getMessages: asyncHandler(async (req: Request, res: Response) => {
    const result = await messagesService.getMessages(
      req.user!.id,
      req.params.id,
      req.query as never,
    );
    sendSuccess(res, { data: result.data, meta: result.meta });
  }),

  markRead: asyncHandler(async (req: Request, res: Response) => {
    const data = await messagesService.markRead(req.user!.id, req.params.id);
    sendSuccess(res, { data });
  }),

  startDirect: asyncHandler(async (req: Request, res: Response) => {
    const data = await messagesService.startDirect(
      req.user!.id,
      req.body.participantId,
      req.body.message,
    );
    sendSuccess(res, { statusCode: StatusCodes.CREATED, data });
  }),

  createGroup: asyncHandler(async (req: Request, res: Response) => {
    const data = await messagesService.createGroup(
      req.user!.id,
      req.body.name,
      req.body.participantIds,
    );
    sendSuccess(res, { statusCode: StatusCodes.CREATED, data });
  }),

  sendMessage: asyncHandler(async (req: Request, res: Response) => {
    const data = await messagesService.sendMessage(
      req.user!.id,
      req.params.id,
      req.body,
    );
    sendSuccess(res, { statusCode: StatusCodes.CREATED, data });
  }),

  renameGroup: asyncHandler(async (req: Request, res: Response) => {
    const data = await messagesService.renameGroup(
      req.user!.id,
      req.params.id,
      req.body.name,
    );
    sendSuccess(res, { data });
  }),

  addParticipants: asyncHandler(async (req: Request, res: Response) => {
    const data = await messagesService.addParticipants(
      req.user!.id,
      req.params.id,
      req.body.participantIds,
    );
    sendSuccess(res, { data });
  }),

  removeParticipant: asyncHandler(async (req: Request, res: Response) => {
    const data = await messagesService.removeParticipant(
      req.user!.id,
      req.params.id,
      req.params.userId,
    );
    sendSuccess(res, { data });
  }),

  leave: asyncHandler(async (req: Request, res: Response) => {
    const data = await messagesService.leave(req.user!.id, req.params.id);
    sendSuccess(res, { data });
  }),

  deleteMessage: asyncHandler(async (req: Request, res: Response) => {
    const data = await messagesService.deleteMessage(
      req.user!.id,
      req.params.id,
      req.params.messageId,
    );
    sendSuccess(res, { data });
  }),
};
