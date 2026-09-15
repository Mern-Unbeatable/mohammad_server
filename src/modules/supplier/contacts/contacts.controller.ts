import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { sendSuccess } from "@/shared/http/apiResponse";
import { asyncHandler } from "@/shared/utils/asyncHandler";
import { contactsService } from "./contacts.service";

export const contactsController = {
  listContacts: asyncHandler(async (req: Request, res: Response) => {
    const result = await contactsService.listContacts(
      req.user!.id,
      req.query as never,
    );
    sendSuccess(res, { data: result.data, meta: result.meta });
  }),

  getContact: asyncHandler(async (req: Request, res: Response) => {
    const data = await contactsService.getContact(
      req.user!.id,
      req.params.id,
    );
    sendSuccess(res, { data });
  }),

  request: asyncHandler(async (req: Request, res: Response) => {
    const data = await contactsService.requestConnection(
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
    const data = await contactsService.respondToConnection(
      req.user!.id,
      req.params.id,
      true,
    );
    sendSuccess(res, { data, message: "Connection accepted" });
  }),

  decline: asyncHandler(async (req: Request, res: Response) => {
    const data = await contactsService.respondToConnection(
      req.user!.id,
      req.params.id,
      false,
    );
    sendSuccess(res, { data, message: "Connection declined" });
  }),

  remove: asyncHandler(async (req: Request, res: Response) => {
    await contactsService.removeConnection(req.user!.id, req.params.id);
    sendSuccess(res, { data: { message: "Connection removed" } });
  }),
};
