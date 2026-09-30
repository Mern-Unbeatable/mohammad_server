import { Request, Response } from "express";
import { sendSuccess } from "@/shared/http/apiResponse";
import { asyncHandler } from "@/shared/utils/asyncHandler";
import { settingsService } from "./settings.service";

export const settingsController = {
  getSettings: asyncHandler(async (_req: Request, res: Response) => {
    const data = await settingsService.getSettings();
    sendSuccess(res, { data });
  }),

  getSetting: asyncHandler(async (req: Request, res: Response) => {
    const data = await settingsService.getSetting(req.params.key);
    sendSuccess(res, { data });
  }),

  upsertSetting: asyncHandler(async (req: Request, res: Response) => {
    const data = await settingsService.upsertSetting(
      req.params.key,
      req.body.value,
    );
    sendSuccess(res, { data, message: "Setting saved" });
  }),
};
