import { NextFunction, Request, Response } from "express";
import { Role } from "@prisma/client";
import { ForbiddenError, UnauthenticatedError } from "@/shared/errors/AppError";

/** Restricts a route to one or more roles. Must run after `authenticate`. */
export const authorize =
  (...roles: Role[]) =>
  (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      throw new UnauthenticatedError();
    }
    if (roles.length > 0 && !roles.includes(req.user.role)) {
      throw new ForbiddenError();
    }
    next();
  };
