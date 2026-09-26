import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { sendSuccess } from "@/shared/http/apiResponse";
import { asyncHandler } from "@/shared/utils/asyncHandler";
import { authService } from "./auth.service";

export const authController = {
  register: asyncHandler(async (req: Request, res: Response) => {
    const result = await authService.register(req.body);
    sendSuccess(res, { statusCode: StatusCodes.CREATED, data: result });
  }),

  login: asyncHandler(async (req: Request, res: Response) => {
    const result = await authService.login(req.body);
    sendSuccess(res, { data: result });
  }),

  refresh: asyncHandler(async (req: Request, res: Response) => {
    const result = await authService.refresh(req.body.refreshToken);
    sendSuccess(res, { data: result });
  }),

  logout: asyncHandler(async (req: Request, res: Response) => {
    await authService.logout(req.body.refreshToken);
    sendSuccess(res, { data: { message: "Logged out" } });
  }),

  forgotPassword: asyncHandler(async (req: Request, res: Response) => {
    await authService.forgotPassword(req.body);
    sendSuccess(res, {
      data: {
        message:
          "If an account exists for that email, a password reset link has been sent.",
      },
    });
  }),

  resetPassword: asyncHandler(async (req: Request, res: Response) => {
    await authService.resetPassword(req.body);
    sendSuccess(res, {
      data: {
        message:
          "Your password has been reset. Please sign in with your new password.",
      },
    });
  }),

  me: asyncHandler(async (req: Request, res: Response) => {
    const result = await authService.me(req.user!.id);
    sendSuccess(res, { data: result });
  }),
};
