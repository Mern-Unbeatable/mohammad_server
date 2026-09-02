import { Request, Response } from "express";
import { UserStatus } from "@prisma/client";
import { sendSuccess } from "@/shared/http/apiResponse";
import { asyncHandler } from "@/shared/utils/asyncHandler";
import { usersService } from "./users.service";

export const usersController = {
  getMe: asyncHandler(async (req: Request, res: Response) => {
    const data = await usersService.getMe(req.user!.id);
    sendSuccess(res, { data });
  }),

  updateProfile: asyncHandler(async (req: Request, res: Response) => {
    const data = await usersService.updateProfile(req.user!.id, req.body);
    sendSuccess(res, { data, message: "Profile updated" });
  }),

  changePassword: asyncHandler(async (req: Request, res: Response) => {
    await usersService.changePassword(req.user!.id, req.body);
    sendSuccess(res, { data: { message: "Password changed" } });
  }),

  list: asyncHandler(async (req: Request, res: Response) => {
    const result = await usersService.listUsers(req.query as never);
    sendSuccess(res, { data: result.data, meta: result.meta });
  }),

  getById: asyncHandler(async (req: Request, res: Response) => {
    const data = await usersService.getUserById(req.params.id);
    sendSuccess(res, { data });
  }),

  updateStatus: asyncHandler(async (req: Request, res: Response) => {
    const data = await usersService.updateStatus(
      req.params.id,
      req.body.status as UserStatus,
      req.user!.id,
      req.body.reason,
    );
    sendSuccess(res, { data, message: "User status updated" });
  }),
};
