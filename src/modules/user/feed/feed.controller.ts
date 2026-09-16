import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { FeedPostType, ReactionType } from "@prisma/client";
import { sendSuccess } from "@/shared/http/apiResponse";
import { asyncHandler } from "@/shared/utils/asyncHandler";
import { feedService } from "./feed.service";

export const feedController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    const result = await feedService.list(req.user!.id, req.query as never);
    sendSuccess(res, { data: result.data, meta: result.meta });
  }),

  getById: asyncHandler(async (req: Request, res: Response) => {
    const data = await feedService.getById(req.params.id, req.user!.id);
    sendSuccess(res, { data });
  }),

  create: asyncHandler(async (req: Request, res: Response) => {
    const data = await feedService.create(req.user!.id, {
      ...req.body,
      type: req.body.type as FeedPostType,
    });
    sendSuccess(res, { statusCode: StatusCodes.CREATED, data });
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    const data = await feedService.update(
      req.user!.id,
      req.params.id,
      req.body,
    );
    sendSuccess(res, { data });
  }),

  remove: asyncHandler(async (req: Request, res: Response) => {
    await feedService.remove(req.user!.id, req.user!.role, req.params.id);
    sendSuccess(res, { data: { message: "Post deleted" } });
  }),

  addComment: asyncHandler(async (req: Request, res: Response) => {
    const data = await feedService.addComment(
      req.params.id,
      req.user!.id,
      req.body.content,
      req.body.parentCommentId,
    );
    sendSuccess(res, { statusCode: StatusCodes.CREATED, data });
  }),

  removeComment: asyncHandler(async (req: Request, res: Response) => {
    await feedService.removeComment(
      req.user!.id,
      req.user!.role,
      req.params.id,
      req.params.commentId,
    );
    sendSuccess(res, { data: { message: "Comment deleted" } });
  }),

  likeComment: asyncHandler(async (req: Request, res: Response) => {
    const data = await feedService.likeComment(
      req.params.id,
      req.params.commentId,
      req.user!.id,
    );
    sendSuccess(res, { data });
  }),

  react: asyncHandler(async (req: Request, res: Response) => {
    const data = await feedService.react(
      req.params.id,
      req.user!.id,
      req.body.type as ReactionType,
    );
    sendSuccess(res, { data });
  }),
};
