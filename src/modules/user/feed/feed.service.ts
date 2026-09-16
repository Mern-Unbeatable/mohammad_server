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

const postInclude = {
  author: { include: { profile: true } },
  comments: {
    orderBy: { createdAt: "asc" as const },
    include: { author: { include: { profile: true } } },
  },
  _count: { select: { reactions: true, comments: true } },
} satisfies Prisma.FeedPostInclude;

type PostPayload = Prisma.FeedPostGetPayload<{ include: typeof postInclude }>;

const serializeAuthor = (user: {
  id: string;
  profile: Prisma.ProfileGetPayload<object> | null;
}) => ({
  id: user.id,
  ...(user.profile ? serializeProfile(user.profile) : {}),
});

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
  comments: post.comments.map((c) => ({
    id: c.id,
    content: c.content,
    createdAt: c.createdAt,
    author: serializeAuthor(c.author),
  })),
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
        include: postInclude,
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
      include: postInclude,
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
      include: postInclude,
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
      include: postInclude,
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

  async addComment(postId: string, authorId: string, content: string) {
    const post = await prisma.feedPost.findUnique({ where: { id: postId } });
    if (!post) throw new NotFoundError("Post not found");

    const comment = await prisma.feedComment.create({
      data: { postId, authorId, content },
      include: { author: { include: { profile: true } } },
    });

    if (post.authorId !== authorId) {
      await prisma.notification.create({
        data: {
          userId: post.authorId,
          type: "COMMENT",
          title: "New comment on your post",
          link: `/feed`,
        },
      });
    }

    return {
      id: comment.id,
      content: comment.content,
      createdAt: comment.createdAt,
      author: serializeAuthor(comment.author),
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
