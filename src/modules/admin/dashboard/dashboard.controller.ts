import { Request, Response } from "express";
import { sendSuccess } from "@/shared/http/apiResponse";
import { asyncHandler } from "@/shared/utils/asyncHandler";
import { dashboardService } from "./dashboard.service";

export const dashboardController = {
  dashboard: asyncHandler(async (_req: Request, res: Response) => {
    const data = await dashboardService.dashboard();
    sendSuccess(res, { data });
  }),
};
