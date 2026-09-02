import { Request, Response } from "express";
import { sendSuccess } from "@/shared/http/apiResponse";
import { asyncHandler } from "@/shared/utils/asyncHandler";
import { notificationsService } from "./notifications.service";

export const notificationsController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    const result = await notificationsService.list(
      req.user!.id,
      req.query as never,
    );
    sendSuccess(res, { data: result.data, meta: result.meta });
  }),

  markRead: asyncHandler(async (req: Request, res: Response) => {
    const data = await notificationsService.markRead(
      req.user!.id,
      req.params.id,
    );
    sendSuccess(res, { data });
  }),

  markAllRead: asyncHandler(async (req: Request, res: Response) => {
    await notificationsService.markAllRead(req.user!.id);
    sendSuccess(res, { data: { message: "All notifications marked as read" } });
  }),

  remove: asyncHandler(async (req: Request, res: Response) => {
    await notificationsService.remove(req.user!.id, req.params.id);
    sendSuccess(res, { data: { message: "Notification removed" } });
  }),
};
