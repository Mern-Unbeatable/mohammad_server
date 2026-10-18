import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { sendSuccess } from "@/shared/http/apiResponse";
import { asyncHandler } from "@/shared/utils/asyncHandler";
import { recruitmentService } from "./recruitment.service";

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
    const data = await recruitmentService.apply(
      req.params.id,
      req.user!.id,
      req.body.coverLetter,
    );
    sendSuccess(res, {
      statusCode: StatusCodes.CREATED,
      data,
      message: "Application submitted",
    });
  }),

  listApplications: asyncHandler(async (req: Request, res: Response) => {
    const data = await recruitmentService.listApplications(
      req.user!.id,
      req.user!.role,
      req.params.id,
    );
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
