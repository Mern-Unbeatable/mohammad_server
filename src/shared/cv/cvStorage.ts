import crypto from "node:crypto";
import path from "node:path";
import { env } from "@/config/env";
import { BadRequestError } from "@/shared/errors/AppError";
import { createUploader, privateUploadRoot } from "@/middleware/upload";

/**
 * CVs/résumés are stored privately under `<privateDir>/cv/<applicantId>/` and
 * referenced from a job application by key (`<applicantId>/<file>`). They are
 * never served statically — only through short-lived signed links issued when
 * an authorised viewer (the applicant or the job owner/admin) reads the
 * application. This mirrors the chat-attachment access model.
 */

/** Documents only — a CV is a PDF or Word file. */
const CV_KEY_PATTERN = /^[A-Za-z0-9-]{1,64}\/\d{10,16}-[0-9a-f]{16}\.(pdf|doc|docx)$/;

export const isCvKey = (value: string): boolean => CV_KEY_PATTERN.test(value);

/** Extensions accepted for a CV upload (after server-side content detection). */
export const CV_ALLOWED_EXTENSIONS = new Set([".pdf", ".doc", ".docx"]);

/** Max CV size (10 MB) — well under the global upload limit. */
export const CV_MAX_BYTES = 10 * 1024 * 1024;

export const cvUploadFolder = path.join(privateUploadRoot, "cv");

/** Absolute path of a stored CV; only valid keys are ever resolved. */
export const cvPath = (key: string): string => {
  if (!isCvKey(key)) throw new BadRequestError("Invalid CV reference");
  return path.join(cvUploadFolder, ...key.split("/"));
};

export const cvKeyFor = (applicantId: string, filename: string): string =>
  `${applicantId}/${filename}`;

/** Multer uploader that stages, verifies and stores a single CV per applicant. */
export const cvUpload = createUploader({
  root: cvUploadFolder,
  subdir: (req) => {
    const ownerId = req.user!.id;
    if (!/^[A-Za-z0-9-]{1,64}$/.test(ownerId))
      throw new BadRequestError("Invalid uploader");
    return ownerId;
  },
});

const signingKey = (): Buffer =>
  env.upload.signingSecret
    ? Buffer.from(env.upload.signingSecret)
    : crypto
        .createHmac("sha256", env.jwt.accessSecret)
        .update("cv-file-links")
        .digest();

const signature = (applicationId: string, key: string, exp: number): string =>
  crypto
    .createHmac("sha256", signingKey())
    .update(`${applicationId}\n${key}\n${exp}`)
    .digest("base64url");

/** Expiry rounded to TTL buckets, so the same CV yields a stable link for a while. */
const linkExpiry = (now = Date.now()): number => {
  const ttl = env.upload.signedUrlTtlSeconds;
  return (Math.floor(now / 1000 / ttl) + 2) * ttl;
};

/** Served outside the API prefix so CV downloads do not consume the global API rate limit. */
export const CV_ROUTE_BASE = "/cv-files";

export const cvRoutePath = (applicationId: string, key: string): string =>
  `${CV_ROUTE_BASE}/${applicationId}/${key}`;

export const signCvUrl = (
  applicationId: string,
  key: string,
  now = Date.now(),
): string => {
  const exp = linkExpiry(now);
  const sig = signature(applicationId, key, exp);
  return `${env.upload.publicUrl}${cvRoutePath(applicationId, key)}?exp=${exp}&sig=${sig}`;
};

export const verifyCvSignature = (
  applicationId: string,
  key: string,
  exp: number,
  sig: string,
  now = Date.now(),
): boolean => {
  if (!Number.isFinite(exp) || exp * 1000 <= now) return false;
  const expected = Buffer.from(signature(applicationId, key, exp));
  const provided = Buffer.from(sig);
  return (
    provided.length === expected.length &&
    crypto.timingSafeEqual(provided, expected)
  );
};

/** Serializable CV descriptor (with a fresh signed link) for an authorised viewer. */
export const serializeCv = (
  applicationId: string,
  application: {
    cvKey: string | null;
    cvName: string | null;
    cvMime: string | null;
    cvSize: number | null;
  },
  now = Date.now(),
) =>
  application.cvKey
    ? {
        name: application.cvName,
        mimeType: application.cvMime,
        size: application.cvSize,
        url: signCvUrl(applicationId, application.cvKey, now),
      }
    : null;
