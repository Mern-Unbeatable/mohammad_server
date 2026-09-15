import { Request, Response } from "express";
import { sendSuccess } from "@/shared/http/apiResponse";
import { asyncHandler } from "@/shared/utils/asyncHandler";
import { statisticsService } from "./statistics.service";

export const statisticsController = {
  statistics: asyncHandler(async (req: Request, res: Response) => {
    const year = req.query.year ? Number(req.query.year) : undefined;
    const data = await statisticsService.statistics(year);
    sendSuccess(res, { data });
  }),
};
