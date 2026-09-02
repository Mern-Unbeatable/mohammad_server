import crypto from "node:crypto";
import jwt, { SignOptions } from "jsonwebtoken";
import { Role } from "@prisma/client";
import { env } from "@/config/env";

export interface AccessTokenPayload {
  sub: string;
  role: Role;
  email: string;
}

export const signAccessToken = (payload: AccessTokenPayload): string =>
  jwt.sign(payload, env.jwt.accessSecret, {
    expiresIn: env.jwt.accessExpiresIn,
  } as SignOptions);

export const verifyAccessToken = (token: string): AccessTokenPayload =>
  jwt.verify(token, env.jwt.accessSecret) as AccessTokenPayload;

export interface RefreshTokenPayload {
  sub: string;
  jti: string;
}

export const signRefreshToken = (payload: RefreshTokenPayload): string =>
  jwt.sign(payload, env.jwt.refreshSecret, {
    expiresIn: env.jwt.refreshExpiresIn,
  } as SignOptions);

export const verifyRefreshToken = (token: string): RefreshTokenPayload =>
  jwt.verify(token, env.jwt.refreshSecret) as RefreshTokenPayload;

/** Hashes a refresh token before persistence so DB leaks don't expose it. */
export const hashToken = (token: string): string =>
  crypto.createHash("sha256").update(token).digest("hex");
