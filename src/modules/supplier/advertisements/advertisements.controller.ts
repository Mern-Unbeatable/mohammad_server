import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { AdStatus } from "@prisma/client";
import { sendSuccess } from "@/shared/http/apiResponse";
import { asyncHandler } from "@/shared/utils/asyncHandler";
import { settingsService } from "@/modules/admin/settings/settings.service";
import { advertisementsService } from "./advertisements.service";

export const advertisementsController = {
  pricing: asyncHandler(async (_req: Request, res: Response) => {
    const data = await settingsService.getSponsoredPricing();
    sendSuccess(res, { data });
  }),

  list: asyncHandler(async (req: Request, res: Response) => {
    const result = await advertisementsService.list(
      req.user!.id,
      req.user!.role,
      req.query as never,
    );
    sendSuccess(res, { data: result.data, meta: result.meta });
  }),

  listActive: asyncHandler(async (req: Request, res: Response) => {
    const result = await advertisementsService.listActive(req.query as never);
    sendSuccess(res, { data: result.data, meta: result.meta });
  }),

  getById: asyncHandler(async (req: Request, res: Response) => {
    const data = await advertisementsService.getById(
      req.user!.id,
      req.user!.role,
      req.params.id,
    );
    sendSuccess(res, { data });
  }),

  create: asyncHandler(async (req: Request, res: Response) => {
    const data = await advertisementsService.create(req.user!.id, req.body);
    sendSuccess(res, { statusCode: StatusCodes.CREATED, data });
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    const data = await advertisementsService.update(
      req.user!.id,
      req.params.id,
      req.body,
    );
    sendSuccess(res, { data });
  }),

  remove: asyncHandler(async (req: Request, res: Response) => {
    await advertisementsService.remove(
      req.user!.id,
      req.user!.role,
      req.params.id,
    );
    sendSuccess(res, { data: { message: "Advertisement deleted" } });
  }),

  review: asyncHandler(async (req: Request, res: Response) => {
    const data = await advertisementsService.review(
      req.params.id,
      req.body.status as AdStatus,
      req.body.rejectionReason,
    );
    sendSuccess(res, { data, message: "Advertisement reviewed" });
  }),

  track: asyncHandler(async (req: Request, res: Response) => {
    const metric = req.params.metric === "clicks" ? "clicks" : "views";
    await advertisementsService.track(req.params.id, metric);
    sendSuccess(res, { data: { tracked: metric } });
  }),
};
