import { Request, Response } from "express";
import { sendSuccess } from "@/shared/http/apiResponse";
import { asyncHandler } from "@/shared/utils/asyncHandler";
import { profileService } from "./profile.service";

export const profileController = {
  getMe: asyncHandler(async (req: Request, res: Response) => {
    const data = await profileService.getMe(req.user!.id);
    sendSuccess(res, { data });
  }),

  updateProfile: asyncHandler(async (req: Request, res: Response) => {
    const data = await profileService.updateProfile(req.user!.id, req.body);
    sendSuccess(res, { data, message: "Profile updated" });
  }),

  changePassword: asyncHandler(async (req: Request, res: Response) => {
    await profileService.changePassword(req.user!.id, req.body);
    sendSuccess(res, { data: { message: "Password changed" } });
  }),
};
