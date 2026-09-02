import { Role } from "@prisma/client";

/** Authenticated principal attached to the request by the auth middleware. */
export interface AuthUser {
  id: string;
  role: Role;
  email: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export {};
