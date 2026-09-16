import { Request, Response } from "express";
import { SubscriptionPlan } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
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
    const result = await subscriptionsService.subscribe(
      req.user!.id,
      req.body.plan as SubscriptionPlan,
    );
    sendSuccess(res, {
      data: result,
      message: "Redirect to Stripe Checkout to complete payment",
    });
  }),

  confirmCheckout: asyncHandler(async (req: Request, res: Response) => {
    const sessionId = String(req.body.sessionId || req.query.session_id || "");
    const data = await subscriptionsService.confirmCheckout(
      req.user!.id,
      sessionId,
    );
    sendSuccess(res, { data, message: "Checkout confirmed" });
  }),

  cancel: asyncHandler(async (req: Request, res: Response) => {
    const data = await subscriptionsService.cancel(req.user!.id);
    sendSuccess(res, { data, message: "Subscription cancelled" });
  }),

  /**
   * Stripe webhook — must receive the raw request body (see app.ts).
   */
  webhook: asyncHandler(async (req: Request, res: Response) => {
    const signature = req.headers["stripe-signature"];
    const rawBody = req.body as Buffer;
    const data = await subscriptionsService.handleStripeWebhook(
      rawBody,
      typeof signature === "string" ? signature : undefined,
    );
    res.status(StatusCodes.OK).json(data);
  }),
};
