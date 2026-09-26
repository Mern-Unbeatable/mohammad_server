import { NextFunction, Request, Response } from "express";
import { UserStatus } from "@prisma/client";
import { prisma } from "@/infrastructure/prisma";
import { ForbiddenError, UnauthenticatedError } from "@/shared/errors/AppError";

/**
 * Rejects suspended/banned accounts even while their access token is still valid.
 * Must run after `authenticate`.
 */
export const requireActiveUser = async (
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!req.user) throw new UnauthenticatedError();
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { status: true },
    });
    if (!user) throw new UnauthenticatedError();
    if (user.status !== UserStatus.ACTIVE) {
      throw new ForbiddenError("Your account is not active");
    }
    next();
  } catch (error) {
    next(error);
  }
};
