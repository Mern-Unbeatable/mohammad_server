import { Request, Response } from "express";
import { sendSuccess } from "@/shared/http/apiResponse";
import { asyncHandler } from "@/shared/utils/asyncHandler";
import { contactService } from "./contact.service";

export const contactController = {
  send: asyncHandler(async (req: Request, res: Response) => {
    await contactService.send(req.body);
    sendSuccess(res, { data: { message: "Your message has been sent." } });
  }),
};
