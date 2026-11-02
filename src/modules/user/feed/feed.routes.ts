import { Router } from "express";
import { authenticate } from "@/middleware/authenticate";
import { requireEntitlement } from "@/middleware/requireEntitlement";
import { validate } from "@/middleware/validate";
import { feedController } from "./feed.controller";
import {
  commentParamSchema,
  createCommentSchema,
  createPostSchema,
  feedListQuerySchema,
  feedAdsQuerySchema,
  postIdParamSchema,
  reactionListQuerySchema,
  reactionSchema,
  repostSchema,
  updateCommentSchema,
  updatePostSchema,
} from "./feed.validators";

const router = Router();

router.use(authenticate, requireEntitlement);

router.get("/", validate({ query: feedListQuerySchema }), feedController.list);
router.get("/ads/active", validate({ query: feedAdsQuerySchema }), feedController.listAds);
router.post("/", validate({ body: createPostSchema }), feedController.create);
router.get(
  "/:id",
  validate({ params: postIdParamSchema }),
  feedController.getById,
);
router.patch(
  "/:id",
  validate({ params: postIdParamSchema, body: updatePostSchema }),
  feedController.update,
);
router.delete(
  "/:id",
  validate({ params: postIdParamSchema }),
  feedController.remove,
);

router.post(
  "/:id/comments",
  validate({ params: postIdParamSchema, body: createCommentSchema }),
  feedController.addComment,
);
router.patch(
  "/:id/comments/:commentId",
  validate({ params: commentParamSchema, body: updateCommentSchema }),
  feedController.updateComment,
);
router.delete(
  "/:id/comments/:commentId",
  validate({ params: commentParamSchema }),
  feedController.removeComment,
);
router.post(
  "/:id/comments/:commentId/like",
  validate({ params: commentParamSchema }),
  feedController.likeComment,
);

router.get(
  "/:id/reactions",
  validate({ params: postIdParamSchema, query: reactionListQuerySchema }),
  feedController.listReactions,
);
router.post(
  "/:id/reactions",
  validate({ params: postIdParamSchema, body: reactionSchema }),
  feedController.react,
);

router.post(
  "/:id/repost",
  validate({ params: postIdParamSchema, body: repostSchema }),
  feedController.repost,
);
router.delete(
  "/:id/repost",
  validate({ params: postIdParamSchema }),
  feedController.undoRepost,
);

export const feedRoutes = router;
