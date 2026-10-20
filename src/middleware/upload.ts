import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import multer from "multer";
import { NextFunction, Request, RequestHandler, Response } from "express";
import { env } from "@/config/env";
import { BadRequestError } from "@/shared/errors/AppError";
import {
  detectFileTypeFromPath,
  judgeUpload,
  sanitizeOriginalName,
} from "@/shared/files/fileType";

export const publicUploadRoot = path.resolve(process.cwd(), env.upload.dir);
export const privateUploadRoot = path.resolve(process.cwd(), env.upload.privateDir);

interface UploaderOptions {
  root: string;
  /** Optional sub-folder (relative to `root`) chosen per request, e.g. the uploader's id. */
  subdir?: (req: Request) => string;
}

const filesOf = (req: Request): Express.Multer.File[] => {
  if (req.file) return [req.file];
  if (Array.isArray(req.files)) return req.files;
  return [];
};

const removeQuietly = (filePath: string) =>
  fs.promises.unlink(filePath).catch(() => undefined);

/**
 * Multer writes into a hidden staging folder under a random name with no
 * extension. Each file is then identified from its bytes; accepted files are
 * moved into place under a server-chosen extension and MIME type, and the
 * whole request is rejected (and staged files deleted) if any file fails.
 */
export const createUploader = ({ root, subdir }: UploaderOptions) => {
  // Dot-folders are never served by express.static (dotfiles: "ignore").
  const staging = path.join(root, ".incoming");

  const parser = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => {
        fs.promises.mkdir(staging, { recursive: true }).then(
          () => cb(null, staging),
          (error: Error) => cb(error, staging),
        );
      },
      filename: (_req, _file, cb) => cb(null, crypto.randomBytes(16).toString("hex")),
    }),
    limits: {
      fileSize: env.upload.maxSizeMb * 1024 * 1024,
      files: env.upload.maxFiles,
      fields: 20,
      fieldSize: 64 * 1024,
    },
  });

  const finalize: RequestHandler = async (req: Request, _res: Response, next: NextFunction) => {
    const files = filesOf(req);
    try {
      const verdicts = await Promise.all(
        files.map(async (file) =>
          judgeUpload(
            await detectFileTypeFromPath(file.path, path.extname(file.originalname)),
            file.originalname,
            file.mimetype,
          ),
        ),
      );
      const rejectedAt = verdicts.findIndex((verdict) => !verdict.ok);
      if (rejectedAt !== -1) {
        const verdict = verdicts[rejectedAt] as { ok: false; reason: string };
        throw new BadRequestError(verdict.reason, {
          file: sanitizeOriginalName(files[rejectedAt].originalname),
        });
      }

      const folder = path.join(root, subdir?.(req) ?? "");
      await fs.promises.mkdir(folder, { recursive: true });
      for (const [index, file] of files.entries()) {
        const { type } = verdicts[index] as { ok: true; type: { ext: string; mimeType: string } };
        const filename = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}${type.ext}`;
        const destination = path.join(folder, filename);
        await fs.promises.rename(file.path, destination);
        Object.assign(file, {
          filename,
          path: destination,
          destination: folder,
          mimetype: type.mimeType,
          originalname: sanitizeOriginalName(file.originalname),
        });
      }
      next();
    } catch (error) {
      await Promise.all(files.map((file) => removeQuietly(file.path)));
      next(error);
    }
  };

  return {
    single: (field: string): RequestHandler[] => [parser.single(field), finalize],
    array: (field: string, maxCount = env.upload.maxFiles): RequestHandler[] => [
      parser.array(field, Math.min(maxCount, env.upload.maxFiles)),
      finalize,
    ],
  };
};

/** Public uploads (avatars, listings, ads, …), served from `/${env.upload.dir}`. */
export const upload = createUploader({ root: publicUploadRoot });

/** Builds a public, absolute URL for an uploaded file. */
export const buildFileUrl = (filename: string): string =>
  `${env.upload.publicUrl}/${env.upload.dir}/${filename}`;
