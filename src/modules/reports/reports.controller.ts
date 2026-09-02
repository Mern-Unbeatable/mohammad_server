import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { ModerationAction, ReportStatus } from "@prisma/client";
import { sendSuccess } from "@/shared/http/apiResponse";
import { asyncHandler } from "@/shared/utils/asyncHandler";
import { reportsService } from "./reports.service";

export const reportsController = {
  create: asyncHandler(async (req: Request, res: Response) => {
    const data = await reportsService.create(req.user!.id, req.body);
    sendSuccess(res, {
      statusCode: StatusCodes.CREATED,
      data,
      message: "Report submitted",
    });
  }),

  list: asyncHandler(async (req: Request, res: Response) => {
    const result = await reportsService.list(req.query as never);
    sendSuccess(res, { data: result.data, meta: result.meta });
  }),

  stats: asyncHandler(async (_req: Request, res: Response) => {
    const data = await reportsService.stats();
    sendSuccess(res, { data });
  }),

  getById: asyncHandler(async (req: Request, res: Response) => {
    const data = await reportsService.getById(req.params.id);
    sendSuccess(res, { data });
  }),

  updateStatus: asyncHandler(async (req: Request, res: Response) => {
    const data = await reportsService.updateStatus(
      req.params.id,
      req.body.status as ReportStatus,
    );
    sendSuccess(res, { data });
  }),

  moderate: asyncHandler(async (req: Request, res: Response) => {
    const data = await reportsService.moderate(
      req.user!.id,
      req.params.id,
      req.body.action as ModerationAction,
      req.body.note,
    );
    sendSuccess(res, { data, message: "Moderation action applied" });
  }),
};
