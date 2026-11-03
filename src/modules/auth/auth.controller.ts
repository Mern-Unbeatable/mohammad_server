import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { sendSuccess } from "@/shared/http/apiResponse";
import { asyncHandler } from "@/shared/utils/asyncHandler";
import {
  clearAuthCookies,
  readRefreshCookie,
  setAuthCookies,
} from "@/shared/http/authCookies";
import { authService } from "./auth.service";

export const authController = {
  register: asyncHandler(async (req: Request, res: Response) => {
    const result = await authService.register(req.body);
    setAuthCookies(res, result);
    sendSuccess(res, { statusCode: StatusCodes.CREATED, data: result });
  }),

  login: asyncHandler(async (req: Request, res: Response) => {
    const result = await authService.login(req.body);
    setAuthCookies(res, result);
    sendSuccess(res, { data: result });
  }),

  refresh: asyncHandler(async (req: Request, res: Response) => {
    // Browser clients send the refresh token via httpOnly cookie; API clients
    // may still send it in the body.
    const refreshToken = req.body?.refreshToken || readRefreshCookie(req);
    const result = await authService.refresh(refreshToken);
    setAuthCookies(res, result);
    sendSuccess(res, { data: result });
  }),

  logout: asyncHandler(async (req: Request, res: Response) => {
    const refreshToken = req.body?.refreshToken || readRefreshCookie(req);
    if (refreshToken) {
      await authService.logout(refreshToken);
    }
    clearAuthCookies(res);
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

  verifyResetToken: asyncHandler(async (req: Request, res: Response) => {
    const result = await authService.verifyResetToken(req.body.token);
    sendSuccess(res, { data: result });
  }),

  resetPassword: asyncHandler(async (req: Request, res: Response) => {
    await authService.resetPassword(req.body);
    clearAuthCookies(res);
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
