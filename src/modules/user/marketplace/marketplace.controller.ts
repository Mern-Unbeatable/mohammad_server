import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { sendSuccess } from "@/shared/http/apiResponse";
import { asyncHandler } from "@/shared/utils/asyncHandler";
import { marketplaceService } from "./marketplace.service";

export const marketplaceController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    const result = await marketplaceService.list(
      req.user!.id,
      req.query as never,
    );
    sendSuccess(res, { data: result.data, meta: result.meta });
  }),

  getById: asyncHandler(async (req: Request, res: Response) => {
    const data = await marketplaceService.getById(req.user!.id, req.params.id);
    sendSuccess(res, { data });
  }),

  create: asyncHandler(async (req: Request, res: Response) => {
    const data = await marketplaceService.create(req.user!.id, req.body);
    sendSuccess(res, { statusCode: StatusCodes.CREATED, data });
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    const data = await marketplaceService.update(
      req.user!.id,
      req.user!.role,
      req.params.id,
      req.body,
    );
    sendSuccess(res, { data });
  }),

  remove: asyncHandler(async (req: Request, res: Response) => {
    await marketplaceService.remove(
      req.user!.id,
      req.user!.role,
      req.params.id,
    );
    sendSuccess(res, { data: { message: "Listing deleted" } });
  }),

  toggleSave: asyncHandler(async (req: Request, res: Response) => {
    const data = await marketplaceService.toggleSave(
      req.user!.id,
      req.params.id,
    );
    sendSuccess(res, { data });
  }),
};
