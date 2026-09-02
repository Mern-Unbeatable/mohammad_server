import { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { sendSuccess } from "@/shared/http/apiResponse";
import { asyncHandler } from "@/shared/utils/asyncHandler";
import { adminService } from "./admin.service";

export const adminController = {
  dashboard: asyncHandler(async (_req: Request, res: Response) => {
    const data = await adminService.dashboard();
    sendSuccess(res, { data });
  }),

  statistics: asyncHandler(async (req: Request, res: Response) => {
    const year = req.query.year ? Number(req.query.year) : undefined;
    const data = await adminService.statistics(year);
    sendSuccess(res, { data });
  }),

  getSettings: asyncHandler(async (_req: Request, res: Response) => {
    const data = await adminService.getSettings();
    sendSuccess(res, { data });
  }),

  getSetting: asyncHandler(async (req: Request, res: Response) => {
    const data = await adminService.getSetting(req.params.key);
    sendSuccess(res, { data });
  }),

  upsertSetting: asyncHandler(async (req: Request, res: Response) => {
    const data = await adminService.upsertSetting(
      req.params.key,
      req.body.value as Prisma.InputJsonValue,
    );
    sendSuccess(res, { data, message: "Setting saved" });
  }),
};
