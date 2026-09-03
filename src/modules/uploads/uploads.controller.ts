import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { sendSuccess } from "@/shared/http/apiResponse";
import { asyncHandler } from "@/shared/utils/asyncHandler";
import { buildFileUrl } from "@/middleware/upload";
import { BadRequestError } from "@/shared/errors/AppError";

const describe = (file: Express.Multer.File) => ({
  url: buildFileUrl(file.filename),
  filename: file.filename,
  originalName: file.originalname,
  mimeType: file.mimetype,
  size: file.size,
});

export const uploadsController = {
  single: asyncHandler(async (req: Request, res: Response) => {
    if (!req.file) throw new BadRequestError("No file provided");
    sendSuccess(res, {
      statusCode: StatusCodes.CREATED,
      data: describe(req.file),
    });
  }),

  multiple: asyncHandler(async (req: Request, res: Response) => {
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (files.length === 0) throw new BadRequestError("No files provided");
    sendSuccess(res, {
      statusCode: StatusCodes.CREATED,
      data: files.map(describe),
    });
  }),
};
