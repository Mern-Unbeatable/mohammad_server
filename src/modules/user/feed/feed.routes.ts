import { Router } from "express";
import { authenticate } from "@/middleware/authenticate";
import { validate } from "@/middleware/validate";
import { feedController } from "./feed.controller";
import {
  commentParamSchema,
  createCommentSchema,
  createPostSchema,
  feedListQuerySchema,
  postIdParamSchema,
  reactionSchema,
  updatePostSchema,
} from "./feed.validators";

const router = Router();

router.use(authenticate);

router.get("/", validate({ query: feedListQuerySchema }), feedController.list);
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

router.post(
  "/:id/reactions",
  validate({ params: postIdParamSchema, body: reactionSchema }),
  feedController.react,
);

export const feedRoutes = router;
