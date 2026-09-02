import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { sendSuccess } from "@/shared/http/apiResponse";
import { asyncHandler } from "@/shared/utils/asyncHandler";
import { generalService } from "./general.service";

export const generalController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    const result = await generalService.list(req.user!.id, req.query as never);
    sendSuccess(res, { data: result.data, meta: result.meta });
  }),

  getById: asyncHandler(async (req: Request, res: Response) => {
    const data = await generalService.getById(req.params.id);
    sendSuccess(res, { data });
  }),

  create: asyncHandler(async (req: Request, res: Response) => {
    const data = await generalService.create(req.user!.id, req.body);
    sendSuccess(res, { statusCode: StatusCodes.CREATED, data });
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    const data = await generalService.update(
      req.user!.id,
      req.user!.role,
      req.params.id,
      req.body,
    );
    sendSuccess(res, { data });
  }),

  remove: asyncHandler(async (req: Request, res: Response) => {
    await generalService.remove(req.user!.id, req.user!.role, req.params.id);
    sendSuccess(res, { data: { message: "Post deleted" } });
  }),
};
