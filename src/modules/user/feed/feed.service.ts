import { FeedPostType, Prisma, ReactionType } from "@prisma/client";
import { prisma } from "@/infrastructure/prisma";
import { ForbiddenError, NotFoundError } from "@/shared/errors/AppError";
import { buildPaginationMeta } from "@/shared/http/apiResponse";
import { toPrismaPagination } from "@/shared/http/pagination";
import { serializeProfile } from "@/shared/serializers/user.serializer";

const TYPE_MAP: Record<string, FeedPostType> = {
  question: FeedPostType.QUESTION,
  information: FeedPostType.INFORMATION,
  suppliers: FeedPostType.SUPPLIERS,
};

const getCommentInclude = (viewerId?: string) =>
  ({
    author: { include: { profile: true } },
    _count: { select: { likes: true, replies: true } },
    ...(viewerId
      ? {
          likes: {
            where: { userId: viewerId },
            select: { id: true },
            take: 1,
          },
        }
      : {}),
  }) satisfies Prisma.FeedCommentInclude;

const getPostInclude = (viewerId?: string) =>
  ({
    author: { include: { profile: true } },
    comments: {
      orderBy: { createdAt: "asc" as const },
      include: getCommentInclude(viewerId),
    },
    _count: { select: { reactions: true, comments: true } },
  }) satisfies Prisma.FeedPostInclude;

type PostPayload = Prisma.FeedPostGetPayload<{
  include: ReturnType<typeof getPostInclude>;
}>;

type CommentPayload = PostPayload["comments"][number];

const serializeAuthor = (user: {
  id: string;
  profile: Prisma.ProfileGetPayload<object> | null;
}) => ({
  id: user.id,
  ...(user.profile ? serializeProfile(user.profile) : {}),
});

type SerializedComment = {
  id: string;
  content: string;
  createdAt: Date;
  parentCommentId: string | null;
  author: ReturnType<typeof serializeAuthor>;
  likeCount: number;
  liked: boolean;
  isLiked: boolean;
  replyCount: number;
  replies: SerializedComment[];
};

const serializeCommentFlat = (comment: CommentPayload): SerializedComment => {
  const likeRows =
    "likes" in comment && Array.isArray(comment.likes) ? comment.likes : [];
  const likeCount =
    "_count" in comment && comment._count && "likes" in comment._count
      ? comment._count.likes
      : 0;
  const liked = likeRows.length > 0;

  return {
    id: comment.id,
    content: comment.content,
    createdAt: comment.createdAt,
    parentCommentId: comment.parentCommentId ?? null,
    author: serializeAuthor(comment.author),
    likeCount,
    liked,
    isLiked: liked,
    replyCount: 0,
    replies: [],
  };
};

/** Build threads with max_depth = 1 (all replies hang under the root). */
const buildCommentTree = (flat: SerializedComment[]): SerializedComment[] => {
  const byId = new Map(flat.map((c) => [c.id, { ...c, replies: [] as SerializedComment[] }]));
  const roots: SerializedComment[] = [];

  const resolveRootId = (commentId: string): string => {
    let current = byId.get(commentId);
    let guard = 0;
    while (current?.parentCommentId && byId.has(current.parentCommentId) && guard < 50) {
      current = byId.get(current.parentCommentId);
      guard += 1;
    }
    return current?.id ?? commentId;
  };

  for (const comment of flat) {
    const node = byId.get(comment.id)!;
    if (!comment.parentCommentId || !byId.has(comment.parentCommentId)) {
      roots.push(node);
      continue;
    }
    const rootId = resolveRootId(comment.parentCommentId);
    const root = byId.get(rootId);
    if (root && root.id !== node.id) {
      root.replies.push(node);
    } else {
      roots.push(node);
    }
  }

  const byOldest = (a: SerializedComment, b: SerializedComment) =>
    new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();

  roots.sort(byOldest);
  for (const root of roots) {
    root.replies.sort(byOldest);
    root.replyCount = root.replies.length;
    for (const reply of root.replies) {
      reply.replies = [];
      reply.replyCount = 0;
    }
  }
  return roots;
};

const serializePost = (
  post: PostPayload,
  myReaction: ReactionType | null = null,
  reactionCounts: Partial<Record<ReactionType, number>> = {},
) => ({
  id: post.id,
  type: post.type,
  content: post.content,
  imageUrl: post.imageUrl,
  documentUrl: post.documentUrl,
  createdAt: post.createdAt,
  author: serializeAuthor(post.author),
  myReaction,
  reactionCounts: {
    like: reactionCounts.like ?? 0,
    love: reactionCounts.love ?? 0,
    haha: reactionCounts.haha ?? 0,
    wow: reactionCounts.wow ?? 0,
    sad: reactionCounts.sad ?? 0,
    angry: reactionCounts.angry ?? 0,
  },
  stats: {
    reactions: post._count.reactions,
    comments: post._count.comments,
    shares: 0,
  },
  comments: buildCommentTree(post.comments.map(serializeCommentFlat)),
});

const emptyReactionCounts = (): Record<ReactionType, number> => ({
  like: 0,
  love: 0,
  haha: 0,
  wow: 0,
  sad: 0,
  angry: 0,
});

const buildReactionCountsByPost = async (postIds: string[]) => {
  const map = new Map<string, Record<ReactionType, number>>();
  if (postIds.length === 0) return map;

  const grouped = await prisma.feedReaction.groupBy({
    by: ["postId", "type"],
    where: { postId: { in: postIds } },
    _count: { _all: true },
  });

  for (const postId of postIds) {
    map.set(postId, emptyReactionCounts());
  }

  for (const row of grouped) {
    const counts = map.get(row.postId) ?? emptyReactionCounts();
    counts[row.type] = row._count._all;
    map.set(row.postId, counts);
  }

  return map;
};
export const feedService = {
  async list(
    userId: string,
    query: {
      page: number;
      pageSize: number;
      sort: "asc" | "desc";
      type?: string;
      mine?: boolean;
    },
  ) {
    const { skip, take } = toPrismaPagination(query.page, query.pageSize);
    const where: Prisma.FeedPostWhereInput = {
      ...(query.type ? { type: TYPE_MAP[query.type] } : {}),
      ...(query.mine ? { authorId: userId } : {}),
    };

    const [rows, total] = await prisma.$transaction([
      prisma.feedPost.findMany({
        where,
        include: getPostInclude(userId),
        orderBy: { createdAt: query.sort },
        skip,
        take,
      }),
      prisma.feedPost.count({ where }),
    ]);

    const myReactions =
      rows.length === 0
        ? []
        : await prisma.feedReaction.findMany({
            where: {
              userId,
              postId: { in: rows.map((row) => row.id) },
            },
            select: { postId: true, type: true },
          });

    const myReactionByPost = new Map(
      myReactions.map((row) => [row.postId, row.type]),
    );
    const countsByPost = await buildReactionCountsByPost(
      rows.map((row) => row.id),
    );

    return {
      data: rows.map((post) =>
        serializePost(
          post,
          myReactionByPost.get(post.id) ?? null,
          countsByPost.get(post.id),
        ),
      ),
      meta: buildPaginationMeta(query.page, query.pageSize, total),
    };
  },

  async getById(id: string, userId?: string) {
    const post = await prisma.feedPost.findUnique({
      where: { id },
      include: getPostInclude(userId),
    });
    if (!post) throw new NotFoundError("Post not found");

    let myReaction: ReactionType | null = null;
    if (userId) {
      const existing = await prisma.feedReaction.findUnique({
        where: { postId_userId: { postId: id, userId } },
        select: { type: true },
      });
      myReaction = existing?.type ?? null;
    }

    const countsByPost = await buildReactionCountsByPost([id]);
    return serializePost(post, myReaction, countsByPost.get(id));
  },

  async create(
    authorId: string,
    input: {
      type: FeedPostType;
      content: string;
      imageUrl?: string;
      documentUrl?: string;
    },
  ) {
    const post = await prisma.feedPost.create({
      data: { authorId, ...input },
      include: getPostInclude(authorId),
    });
    return serializePost(post);
  },

  async update(userId: string, id: string, input: Prisma.FeedPostUpdateInput) {
    const post = await prisma.feedPost.findUnique({ where: { id } });
    if (!post) throw new NotFoundError("Post not found");
    if (post.authorId !== userId)
      throw new ForbiddenError("You can only edit your own posts");

    const updated = await prisma.feedPost.update({
      where: { id },
      data: input,
      include: getPostInclude(userId),
    });
    return serializePost(updated);
  },

  async remove(userId: string, role: string, id: string) {
    const post = await prisma.feedPost.findUnique({ where: { id } });
    if (!post) throw new NotFoundError("Post not found");
    if (post.authorId !== userId && role !== "ADMIN") {
      throw new ForbiddenError("You can only delete your own posts");
    }
    await prisma.feedPost.delete({ where: { id } });
  },

  async addComment(
    postId: string,
    authorId: string,
    content: string,
    parentCommentId?: string | null,
  ) {
    const post = await prisma.feedPost.findUnique({ where: { id: postId } });
    if (!post) throw new NotFoundError("Post not found");

    let resolvedParentId: string | null = null;
    if (parentCommentId) {
      const parent = await prisma.feedComment.findUnique({
        where: { id: parentCommentId },
      });
      if (!parent || parent.postId !== postId) {
        throw new NotFoundError("Parent comment not found");
      }
      // max_depth = 1: always attach under the root comment
      resolvedParentId = parent.parentCommentId ?? parent.id;
    }

    const comment = await prisma.feedComment.create({
      data: {
        postId,
        authorId,
        content,
        parentCommentId: resolvedParentId,
      },
      include: getCommentInclude(authorId),
    });

    if (post.authorId !== authorId) {
      await prisma.notification.create({
        data: {
          userId: post.authorId,
          type: "COMMENT",
          title: resolvedParentId
            ? "New reply on your post"
            : "New comment on your post",
          link: `/feed`,
        },
      });
    }

    return {
      id: comment.id,
      content: comment.content,
      createdAt: comment.createdAt,
      parentCommentId: resolvedParentId,
      author: serializeAuthor(comment.author),
      likeCount: 0,
      liked: false,
      isLiked: false,
      replyCount: 0,
      replies: [],
    };
  },

  async removeComment(
    userId: string,
    role: string,
    postId: string,
    commentId: string,
  ) {
    const comment = await prisma.feedComment.findUnique({
      where: { id: commentId },
    });
    if (!comment || comment.postId !== postId)
      throw new NotFoundError("Comment not found");
    if (comment.authorId !== userId && role !== "ADMIN") {
      throw new ForbiddenError("You can only delete your own comments");
    }
    await prisma.feedComment.delete({ where: { id: commentId } });
  },

  /** Toggle like on a comment — one like per user via unique (commentId, userId). */
  async likeComment(postId: string, commentId: string, userId: string) {
    const comment = await prisma.feedComment.findUnique({
      where: { id: commentId },
    });
    if (!comment || comment.postId !== postId) {
      throw new NotFoundError("Comment not found");
    }

    const existing = await prisma.feedCommentLike.findUnique({
      where: { commentId_userId: { commentId, userId } },
    });

    let liked: boolean;
    if (existing) {
      await prisma.feedCommentLike.delete({ where: { id: existing.id } });
      liked = false;
    } else {
      await prisma.feedCommentLike.create({
        data: { commentId, userId },
      });
      liked = true;
    }

    const likeCount = await prisma.feedCommentLike.count({
      where: { commentId },
    });

    return {
      commentId,
      liked,
      isLiked: liked,
      likeCount,
    };
  },

  /** Toggle reaction: sets the type, or removes it if the same type is repeated. */
  async react(postId: string, userId: string, type: ReactionType) {
    const post = await prisma.feedPost.findUnique({ where: { id: postId } });
    if (!post) throw new NotFoundError("Post not found");

    const existing = await prisma.feedReaction.findUnique({
      where: { postId_userId: { postId, userId } },
    });

    let myReaction: ReactionType | null;

    if (existing && existing.type === type) {
      await prisma.feedReaction.delete({ where: { id: existing.id } });
      myReaction = null;
    } else {
      await prisma.feedReaction.upsert({
        where: { postId_userId: { postId, userId } },
        create: { postId, userId, type },
        update: { type },
      });
      myReaction = type;
    }

    const reactionCount = await prisma.feedReaction.count({
      where: { postId },
    });
    const countsByPost = await buildReactionCountsByPost([postId]);

    return {
      reacted: Boolean(myReaction),
      type: myReaction,
      myReaction,
      reactionCount,
      reactionCounts: countsByPost.get(postId) ?? emptyReactionCounts(),
      stats: { reactions: reactionCount },
    };
  },
};
