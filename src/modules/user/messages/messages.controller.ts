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
    sendSuccess(res, { data: result.data });
  }),

  getMessages: asyncHandler(async (req: Request, res: Response) => {
    const result = await messagesService.getMessages(
      req.user!.id,
      req.params.id,
      req.query as never,
    );
    sendSuccess(res, { data: result.data, meta: result.meta });
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
      req.body.body,
    );
    sendSuccess(res, { statusCode: StatusCodes.CREATED, data });
  }),
};
