import fs from "node:fs";
import { Request, Response, Router } from "express";
import { ForbiddenError, NotFoundError } from "@/shared/errors/AppError";
import { prisma } from "@/infrastructure/prisma";
import { setUploadSecurityHeaders } from "@/shared/files/serveHeaders";
import { asyncHandler } from "@/shared/utils/asyncHandler";
import { cvPath, isCvKey, verifyCvSignature } from "./cvStorage";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BROWSER_CACHE_SECONDS = 3600;

/**
 * `GET /cv-files/:applicationId/:ownerId/:file?exp&sig` — the signature (issued
 * only to the applicant and the job owner/admin when they read the application)
 * is the access check, and the file must still be the CV attached to that
 * application.
 */
export const cvDownloadRoutes = Router();
cvDownloadRoutes.get(
  "/:applicationId/:ownerId/:file",
  asyncHandler(async (req: Request, res: Response) => {
    const { applicationId, ownerId, file } = req.params;
    const key = `${ownerId}/${file}`;
    const exp = Number(req.query.exp);
    const sig = typeof req.query.sig === "string" ? req.query.sig : "";
    const now = Date.now();

    if (
      !UUID.test(applicationId) ||
      !isCvKey(key) ||
      !verifyCvSignature(applicationId, key, exp, sig, now)
    ) {
      throw new ForbiddenError("This CV link is invalid or has expired");
    }

    const application = await prisma.jobApplication.findUnique({
      where: { id: applicationId },
      select: { cvKey: true, cvName: true },
    });
    if (!application || application.cvKey !== key) {
      throw new NotFoundError("CV not found");
    }

    const filePath = cvPath(key);
    const stat = await fs.promises.stat(filePath).catch(() => null);
    if (!stat?.isFile()) throw new NotFoundError("CV not found");

    setUploadSecurityHeaders(res, filePath, application.cvName ?? undefined);
    res.setHeader("Referrer-Policy", "no-referrer");
    const remaining = Math.floor(exp - now / 1000);
    res.setHeader(
      "Cache-Control",
      `private, max-age=${Math.max(0, Math.min(MAX_BROWSER_CACHE_SECONDS, remaining))}`,
    );
    await new Promise<void>((resolve, reject) =>
      res.sendFile(filePath, { cacheControl: false, dotfiles: "deny" }, (error) =>
        error && !res.headersSent ? reject(error) : resolve(),
      ),
    );
  }),
);
