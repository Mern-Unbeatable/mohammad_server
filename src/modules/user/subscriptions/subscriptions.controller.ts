import { Request, Response } from "express";
import { SubscriptionPlan } from "@prisma/client";
import { sendSuccess } from "@/shared/http/apiResponse";
import { asyncHandler } from "@/shared/utils/asyncHandler";
import { subscriptionsService } from "./subscriptions.service";

export const subscriptionsController = {
  getPlans: asyncHandler(async (_req: Request, res: Response) => {
    sendSuccess(res, { data: subscriptionsService.getPlans() });
  }),

  getMine: asyncHandler(async (req: Request, res: Response) => {
    const data = await subscriptionsService.getMine(req.user!.id);
    sendSuccess(res, { data });
  }),

  subscribe: asyncHandler(async (req: Request, res: Response) => {
    const data = await subscriptionsService.subscribe(
      req.user!.id,
      req.body.plan as SubscriptionPlan,
      req.body.paymentMethod,
    );
    sendSuccess(res, { data, message: "Subscription activated" });
  }),

  cancel: asyncHandler(async (req: Request, res: Response) => {
    const data = await subscriptionsService.cancel(req.user!.id);
    sendSuccess(res, { data, message: "Subscription cancelled" });
  }),
};
