import { NextFunction, Request, Response } from "express";
import { Role } from "@prisma/client";
import { prisma } from "@/infrastructure/prisma";
import { ForbiddenError, UnauthenticatedError } from "@/shared/errors/AppError";
import { deriveSubscriptionState } from "@/modules/user/subscriptions/subscriptionLifecycle";

/**
 * Subscription entitlement gate. Must run after `authenticate`.
 *
 * Subscriptions are a member (USER) concept: ADMIN and SUPPLIER accounts are
 * governed by their role-based access model and bypass this gate. A USER may
 * reach a premium route only while their subscription is effectively active —
 * i.e. an unexpired trial, an ACTIVE paid plan, or a CANCELLED plan still
 * inside its prepaid period. PAST_DUE and EXPIRED members are denied.
 */
export const requireEntitlement = async (
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!req.user) throw new UnauthenticatedError();

    // Role-based accounts are not gated by the member subscription.
    if (req.user.role === Role.ADMIN || req.user.role === Role.SUPPLIER) {
      next();
      return;
    }

    const subscription = await prisma.subscription.findUnique({
      where: { userId: req.user.id },
    });

    if (!subscription || !deriveSubscriptionState(subscription).isActive) {
      throw new ForbiddenError(
        "An active subscription is required to access this feature",
        { code: "SUBSCRIPTION_REQUIRED" },
      );
    }

    next();
  } catch (error) {
    next(error);
  }
};
