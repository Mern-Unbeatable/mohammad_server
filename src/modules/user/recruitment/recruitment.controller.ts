import fs from "node:fs";
import path from "node:path";
import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { BadRequestError } from "@/shared/errors/AppError";
import { sendSuccess } from "@/shared/http/apiResponse";
import { asyncHandler } from "@/shared/utils/asyncHandler";
import { CV_ALLOWED_EXTENSIONS, CV_MAX_BYTES, cvKeyFor } from "@/shared/cv/cvStorage";
import { recruitmentService } from "./recruitment.service";

/** Deletes a just-uploaded CV by its absolute path, so a rejected apply leaves no orphan. */
const removeUploadedFile = (filePath?: string) =>
  filePath ? fs.promises.unlink(filePath).catch(() => undefined) : Promise.resolve();

export const recruitmentController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    const result = await recruitmentService.list(
      req.user!.id,
      req.user!.role,
      req.query as never,
    );
    sendSuccess(res, { data: result.data, meta: result.meta });
  }),

  getById: asyncHandler(async (req: Request, res: Response) => {
    const data = await recruitmentService.getById(
      req.user!.id,
      req.user!.role,
      req.params.id,
    );
    sendSuccess(res, { data });
  }),

  create: asyncHandler(async (req: Request, res: Response) => {
    const data = await recruitmentService.create(req.user!.id, req.body);
    sendSuccess(res, { statusCode: StatusCodes.CREATED, data });
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    const data = await recruitmentService.update(
      req.user!.id,
      req.user!.role,
      req.params.id,
      req.body,
    );
    sendSuccess(res, { data });
  }),

  remove: asyncHandler(async (req: Request, res: Response) => {
    await recruitmentService.remove(
      req.user!.id,
      req.user!.role,
      req.params.id,
    );
    sendSuccess(res, { data: { message: "Job deleted" } });
  }),

  apply: asyncHandler(async (req: Request, res: Response) => {
    const file = req.file;
    if (!file) {
      throw new BadRequestError("A CV/résumé is required to apply");
    }
    const key = cvKeyFor(req.user!.id, file.filename);
    try {
      const ext = path.extname(file.filename).toLowerCase();
      if (!CV_ALLOWED_EXTENSIONS.has(ext)) {
        throw new BadRequestError("Your CV must be a PDF, DOC or DOCX file");
      }
      if (file.size > CV_MAX_BYTES) {
        throw new BadRequestError("Your CV must be 10 MB or smaller");
      }
      const data = await recruitmentService.apply(req.params.id, req.user!.id, {
        coverLetter: req.body.coverLetter,
        cv: {
          key,
          name: file.originalname,
          mime: file.mimetype,
          size: file.size,
        },
      });
      sendSuccess(res, {
        statusCode: StatusCodes.CREATED,
        data,
        message: "Application submitted",
      });
    } catch (error) {
      // Never leave an orphaned CV behind when the application is rejected.
      await removeUploadedFile(file.path);
      throw error;
    }
  }),

  withdraw: asyncHandler(async (req: Request, res: Response) => {
    const data = await recruitmentService.withdraw(
      req.params.id,
      req.user!.id,
    );
    sendSuccess(res, { data, message: "Application cancelled" });
  }),

  listApplications: asyncHandler(async (req: Request, res: Response) => {
    const data = await recruitmentService.listApplications(
      req.user!.id,
      req.user!.role,
      req.params.id,
    );
    sendSuccess(res, { data });
  }),

  newApplicationCounts: asyncHandler(async (req: Request, res: Response) => {
    const data = await recruitmentService.newApplicationCounts(req.user!.id);
    sendSuccess(res, { data });
  }),

  listMyApplications: asyncHandler(async (req: Request, res: Response) => {
    const result = await recruitmentService.listMyApplications(
      req.user!.id,
      req.query as never,
    );
    sendSuccess(res, { data: result.data, meta: result.meta });
  }),
};
