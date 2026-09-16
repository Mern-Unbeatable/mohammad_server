import { Request, Response } from "express";
import { sendSuccess } from "@/shared/http/apiResponse";
import { asyncHandler } from "@/shared/utils/asyncHandler";
import { searchService } from "./search.service";

export const searchController = {
  search: asyncHandler(async (req: Request, res: Response) => {
    const data = await searchService.search(
      req.user!.id,
      req.query as never,
    );
    sendSuccess(res, { data });
  }),
};
