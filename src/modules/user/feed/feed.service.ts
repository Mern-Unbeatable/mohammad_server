import { FeedPostType, Prisma, ReactionType } from "@prisma/client";
import { prisma } from "@/infrastructure/prisma";
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from "@/shared/errors/AppError";
import { buildPaginationMeta } from "@/shared/http/apiResponse";
import { toPrismaPagination } from "@/shared/http/pagination";
import { serializeProfile } from "@/shared/serializers/user.serializer";
import type { CreatePostInput, UpdatePostInput } from "./feed.validators";

const TYPE_MAP: Record<string, FeedPostType> = {
  question: FeedPostType.QUESTION,
  information: FeedPostType.INFORMATION,
  suppliers: FeedPostType.SUPPLIERS,
};

/** Reactors returned per post for the avatar stack next to the reaction count. */
const RECENT_REACTORS_LIMIT = 3;

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
    sharedPost: { include: { author: { include: { profile: true } } } },
    reactions: {
      orderBy: { createdAt: "desc" as const },
      take: RECENT_REACTORS_LIMIT,
      select: {
        user: {
          select: {
            id: true,
            profile: {
              select: { firstName: true, lastName: true, avatarUrl: true, initials: true },
            },
          },
        },
      },
    },
    _count: { select: { reactions: true, comments: true, reposts: true } },
  }) satisfies Prisma.FeedPostInclude;

type PostPayload = Prisma.FeedPostGetPayload<{
  include: ReturnType<typeof getPostInclude>;
}>;

type CommentPayload = PostPayload["comments"][number];

type RepostRef = { id: string; isRepost: boolean; sharedPostId: string | null };

/** The post a repost points at; null once that original has been deleted. */
const getOriginalId = (post: RepostRef) =>
  post.isRepost ? post.sharedPostId : post.id;

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

/** Falls back to `imageUrl` for rows written before `imageUrls` existed. */
const getImageUrls = (post: { imageUrl: string | null; imageUrls?: string[] | null }) =>
  post.imageUrls?.length ? post.imageUrls : post.imageUrl ? [post.imageUrl] : [];

const sameList = (a: string[], b: string[]) =>
  a.length === b.length && a.every((value, index) => value === b[index]);

const serializeSharedPost = (
  post: NonNullable<PostPayload["sharedPost"]>,
) => ({
  id: post.id,
  type: post.type,
  content: post.content,
  imageUrl: getImageUrls(post)[0] ?? null,
  imageUrls: getImageUrls(post),
  documentUrl: post.documentUrl,
  createdAt: post.createdAt,
  author: serializeAuthor(post.author),
});

/**
 * Only `feedService.update` writes to existing posts, so an `updatedAt` past
 * `createdAt` means the author edited it. Any new post write must keep that true.
 */
const getEditedAt = (post: { createdAt: Date; updatedAt: Date }) =>
  post.updatedAt.getTime() - post.createdAt.getTime() > 1000
    ? post.updatedAt
    : null;

const serializePost = (
  post: PostPayload,
  myReaction: ReactionType | null = null,
  reactionCounts: Partial<Record<ReactionType, number>> = {},
  sharedByMe = false,
) => ({
  id: post.id,
  type: post.type,
  content: post.content,
  imageUrl: getImageUrls(post)[0] ?? null,
  imageUrls: getImageUrls(post),
  documentUrl: post.documentUrl,
  createdAt: post.createdAt,
  editedAt: getEditedAt(post),
  author: serializeAuthor(post.author),
  isRepost: post.isRepost,
  sharedPostId: post.sharedPostId,
  sharedPost: post.sharedPost ? serializeSharedPost(post.sharedPost) : null,
  sharedByMe,
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
    shares: post._count.reposts,
  },
  recentReactors: post.reactions.map(({ user }) => ({
    id: user.id,
    name: user.profile
      ? `${user.profile.firstName} ${user.profile.lastName}`.trim()
      : null,
    avatar: user.profile?.avatarUrl ?? null,
    initials: user.profile?.initials ?? null,
  })),
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

/** Ids of originals (among `posts`) that `userId` has already reposted. */
const buildRepostedByMe = async (userId: string | undefined, posts: RepostRef[]) => {
  const originalIds = [
    ...new Set(posts.map(getOriginalId).filter((id): id is string => Boolean(id))),
  ];
  if (!userId || originalIds.length === 0) return new Set<string>();

  const rows = await prisma.feedPost.findMany({
    where: { authorId: userId, sharedPostId: { in: originalIds } },
    select: { sharedPostId: true },
  });
  return new Set(
    rows.map((row) => row.sharedPostId).filter((id): id is string => Boolean(id)),
  );
};

const isRepostedByMe = (repostedByMe: Set<string>, post: RepostRef) => {
  const originalId = getOriginalId(post);
  return Boolean(originalId && repostedByMe.has(originalId));
};

const countReposts = (originalId: string) =>
  prisma.feedPost.count({ where: { sharedPostId: originalId } });

export const feedService = {
  async list(
    userId: string,
    query: {
      page: number;
      pageSize: number;
      sort: "asc" | "desc";
      type?: string;
      mine?: boolean;
      authorId?: string;
    },
  ) {
    const { skip, take } = toPrismaPagination(query.page, query.pageSize);
    const authorId = query.mine ? userId : query.authorId;
    const where: Prisma.FeedPostWhereInput = {
      ...(query.type ? { type: TYPE_MAP[query.type] } : {}),
      ...(authorId ? { authorId } : {}),
    };

    const [rows, total] = await prisma.$transaction([
      prisma.feedPost.findMany({
        where,
        include: getPostInclude(userId),
        // `id` breaks createdAt ties so offset pages never overlap or skip a post.
        orderBy: [{ createdAt: query.sort }, { id: query.sort }],
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
    const repostedByMe = await buildRepostedByMe(userId, rows);

    return {
      data: rows.map((post) =>
        serializePost(
          post,
          myReactionByPost.get(post.id) ?? null,
          countsByPost.get(post.id),
          isRepostedByMe(repostedByMe, post),
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
    const repostedByMe = await buildRepostedByMe(userId, [post]);
    return serializePost(
      post,
      myReaction,
      countsByPost.get(id),
      isRepostedByMe(repostedByMe, post),
    );
  },

  async create(authorId: string, input: CreatePostInput) {
    const post = await prisma.feedPost.create({
      data: {
        authorId,
        type: input.type as FeedPostType,
        content: input.content,
        imageUrls: input.imageUrls,
        imageUrl: input.imageUrls[0] ?? null,
        documentUrl: input.documentUrl,
      },
      include: getPostInclude(authorId),
    });
    return serializePost(post);
  },

  async update(userId: string, id: string, input: UpdatePostInput) {
    const post = await prisma.feedPost.findUnique({ where: { id } });
    if (!post) throw new NotFoundError("Post not found");
    if (post.authorId !== userId)
      throw new ForbiddenError("You can only edit your own posts");

    const currentImages = getImageUrls(post);
    const next = {
      content: input.content ?? post.content,
      imageUrls: input.imageUrls ?? currentImages,
      documentUrl:
        input.documentUrl !== undefined ? input.documentUrl : post.documentUrl,
    };
    if (
      !post.isRepost &&
      !next.content &&
      !next.imageUrls.length &&
      !next.documentUrl
    ) {
      throw new BadRequestError(
        "Post must include content, an image, or a document",
      );
    }

    // Skipping no-op saves keeps `updatedAt`, and so the "edited" state, unchanged.
    const changed =
      next.content !== post.content ||
      !sameList(next.imageUrls, currentImages) ||
      next.documentUrl !== post.documentUrl;
    if (changed) {
      await prisma.feedPost.update({
        where: { id },
        data: { ...next, imageUrl: next.imageUrls[0] ?? null },
      });
    }
    return feedService.getById(id, userId);
  },

  /**
   * Repost an original to the caller's feed. Reposting a repost targets its
   * original; repeating the request returns the existing repost.
   */
  async repost(userId: string, postId: string, content: string) {
    const target = await prisma.feedPost.findUnique({
      where: { id: postId },
      select: { id: true, authorId: true, type: true, isRepost: true, sharedPostId: true },
    });
    if (!target) throw new NotFoundError("Post not found");

    const originalId = getOriginalId(target);
    const original =
      originalId === target.id
        ? target
        : originalId
          ? await prisma.feedPost.findUnique({
              where: { id: originalId },
              select: { id: true, authorId: true, type: true },
            })
          : null;
    if (!original) {
      throw new NotFoundError("The original post is no longer available");
    }
    if (original.authorId === userId) {
      throw new BadRequestError("You can't repost your own post");
    }

    const uniqueKey = {
      authorId_sharedPostId: { authorId: userId, sharedPostId: original.id },
    };
    let existing = await prisma.feedPost.findUnique({
      where: uniqueKey,
      select: { id: true },
    });

    let created = false;
    if (!existing) {
      try {
        existing = await prisma.feedPost.create({
          data: {
            authorId: userId,
            type: original.type,
            content,
            isRepost: true,
            sharedPostId: original.id,
          },
          select: { id: true },
        });
        created = true;
      } catch (error) {
        // A concurrent request created it first.
        if (
          !(error instanceof Prisma.PrismaClientKnownRequestError) ||
          error.code !== "P2002"
        ) {
          throw error;
        }
        existing = await prisma.feedPost.findUniqueOrThrow({
          where: uniqueKey,
          select: { id: true },
        });
      }
    }

    const [post, shares] = await Promise.all([
      feedService.getById(existing.id, userId),
      countReposts(original.id),
    ]);
    return {
      created,
      reposted: true,
      originalPostId: original.id,
      shares,
      post,
    };
  },

  /** Remove the caller's repost of `postId` (or of the original it reposts). Idempotent. */
  async undoRepost(userId: string, postId: string) {
    const target = await prisma.feedPost.findUnique({
      where: { id: postId },
      select: { id: true, isRepost: true, sharedPostId: true },
    });
    if (!target) throw new NotFoundError("Post not found");

    const originalId = getOriginalId(target);
    if (!originalId) {
      throw new NotFoundError("The original post is no longer available");
    }

    const existing = await prisma.feedPost.findUnique({
      where: {
        authorId_sharedPostId: { authorId: userId, sharedPostId: originalId },
      },
      select: { id: true },
    });
    if (existing) {
      await prisma.feedPost.deleteMany({
        where: { id: existing.id, authorId: userId },
      });
    }

    return {
      reposted: false,
      originalPostId: originalId,
      repostId: existing?.id ?? null,
      shares: await countReposts(originalId),
    };
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

  /** Only the author may edit; unlike delete, admins get no override. */
  async updateComment(
    userId: string,
    postId: string,
    commentId: string,
    content: string,
  ) {
    const comment = await prisma.feedComment.findUnique({
      where: { id: commentId },
    });
    if (!comment || comment.postId !== postId)
      throw new NotFoundError("Comment not found");
    if (comment.authorId !== userId) {
      throw new ForbiddenError("You can only edit your own comments");
    }

    const include = getCommentInclude(userId);
    const saved =
      content === comment.content
        ? await prisma.feedComment.findUniqueOrThrow({
            where: { id: commentId },
            include,
          })
        : await prisma.feedComment.update({
            where: { id: commentId },
            data: { content },
            include,
          });
    return serializeCommentFlat(saved);
  },

  /** Deleting a root comment cascades to its replies, so the new total is re-counted. */
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
    const commentCount = await prisma.feedComment.count({ where: { postId } });
    return { postId, commentId, commentCount };
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

  /** Who reacted to a post, newest first; `type` narrows to one reaction. */
  async listReactions(
    postId: string,
    query: { page: number; pageSize: number; type?: ReactionType },
  ) {
    const post = await prisma.feedPost.findUnique({
      where: { id: postId },
      select: { id: true },
    });
    if (!post) throw new NotFoundError("Post not found");

    const { skip, take } = toPrismaPagination(query.page, query.pageSize);
    const where: Prisma.FeedReactionWhereInput = {
      postId,
      ...(query.type ? { type: query.type } : {}),
    };

    const [rows, total, countsByPost] = await Promise.all([
      prisma.feedReaction.findMany({
        where,
        include: { user: { include: { profile: true } } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip,
        take,
      }),
      prisma.feedReaction.count({ where }),
      buildReactionCountsByPost([postId]),
    ]);

    return {
      data: rows.map((row) => ({
        id: row.id,
        type: row.type,
        createdAt: row.createdAt,
        user: serializeAuthor(row.user),
      })),
      meta: buildPaginationMeta(query.page, query.pageSize, total),
      reactionCounts: countsByPost.get(postId) ?? emptyReactionCounts(),
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
