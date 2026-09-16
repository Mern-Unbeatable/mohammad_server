import { Request, Response } from "express";
import { UserStatus } from "@prisma/client";
import { sendSuccess } from "@/shared/http/apiResponse";
import { asyncHandler } from "@/shared/utils/asyncHandler";
import { usersService } from "./users.service";

export const usersController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    const result = await usersService.listUsers(req.query as never);
    sendSuccess(res, { data: result.data, meta: result.meta });
  }),

  getById: asyncHandler(async (req: Request, res: Response) => {
    const data = await usersService.getUserById(req.params.id, req.user!.role);
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
