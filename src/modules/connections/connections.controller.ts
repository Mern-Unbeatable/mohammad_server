import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { sendSuccess } from "@/shared/http/apiResponse";
import { asyncHandler } from "@/shared/utils/asyncHandler";
import { connectionsService } from "./connections.service";

export const connectionsController = {
  listContacts: asyncHandler(async (req: Request, res: Response) => {
    const result = await connectionsService.listContacts(
      req.user!.id,
      req.query as never,
    );
    sendSuccess(res, { data: result.data, meta: result.meta });
  }),

  getContact: asyncHandler(async (req: Request, res: Response) => {
    const data = await connectionsService.getContact(
      req.user!.id,
      req.params.id,
    );
    sendSuccess(res, { data });
  }),

  request: asyncHandler(async (req: Request, res: Response) => {
    const data = await connectionsService.requestConnection(
      req.user!.id,
      req.body.addresseeId,
    );
    sendSuccess(res, {
      statusCode: StatusCodes.CREATED,
      data,
      message: "Connection requested",
    });
  }),

  accept: asyncHandler(async (req: Request, res: Response) => {
    const data = await connectionsService.respondToConnection(
      req.user!.id,
      req.params.id,
      true,
    );
    sendSuccess(res, { data, message: "Connection accepted" });
  }),

  decline: asyncHandler(async (req: Request, res: Response) => {
    const data = await connectionsService.respondToConnection(
      req.user!.id,
      req.params.id,
      false,
    );
    sendSuccess(res, { data, message: "Connection declined" });
  }),

  remove: asyncHandler(async (req: Request, res: Response) => {
    await connectionsService.removeConnection(req.user!.id, req.params.id);
    sendSuccess(res, { data: { message: "Connection removed" } });
  }),
};
