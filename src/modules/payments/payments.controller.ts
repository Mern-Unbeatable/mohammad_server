import { Request, Response } from "express";
import { sendSuccess } from "@/shared/http/apiResponse";
import { asyncHandler } from "@/shared/utils/asyncHandler";
import { paymentsService } from "./payments.service";

export const paymentsController = {
  listMine: asyncHandler(async (req: Request, res: Response) => {
    const result = await paymentsService.listMine(req.user!.id, req.query as never);
    sendSuccess(res, { data: result.data, meta: result.meta });
  }),

  links: asyncHandler(async (req: Request, res: Response) => {
    const data = await paymentsService.getLinks(req.params.id, req.user!);
    sendSuccess(res, { data });
  }),

  listAll: asyncHandler(async (req: Request, res: Response) => {
    const result = await paymentsService.listAll(req.query as never);
    sendSuccess(res, { data: result.data, meta: result.meta });
  }),

  syncAll: asyncHandler(async (_req: Request, res: Response) => {
    const data = await paymentsService.syncAll();
    sendSuccess(res, { data, message: "Payment history synced from Stripe" });
  }),
};
