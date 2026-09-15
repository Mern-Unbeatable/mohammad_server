import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { sendSuccess } from "@/shared/http/apiResponse";
import { asyncHandler } from "@/shared/utils/asyncHandler";
import { blogsService } from "./blogs.service";

export const blogsController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    const includeUnpublished = req.user?.role === "ADMIN";
    const result = await blogsService.list(
      req.query as never,
      includeUnpublished,
    );
    sendSuccess(res, { data: result.data, meta: result.meta });
  }),

  getBySlug: asyncHandler(async (req: Request, res: Response) => {
    const data = await blogsService.getBySlug(req.params.slug);
    sendSuccess(res, { data });
  }),

  create: asyncHandler(async (req: Request, res: Response) => {
    const data = await blogsService.create(req.user!.id, req.body);
    sendSuccess(res, { statusCode: StatusCodes.CREATED, data });
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    const data = await blogsService.update(req.params.id, req.body);
    sendSuccess(res, { data });
  }),

  remove: asyncHandler(async (req: Request, res: Response) => {
    await blogsService.remove(req.params.id);
    sendSuccess(res, { data: { message: "Article deleted" } });
  }),
};
