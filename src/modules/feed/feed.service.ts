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

const serializePost = (post: PostPayload) => ({
  id: post.id,
  type: post.type,
  content: post.content,
  imageUrl: post.imageUrl,
  documentUrl: post.documentUrl,
  createdAt: post.createdAt,
  author: serializeAuthor(post.author),
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

    return {
      data: rows.map(serializePost),
      meta: buildPaginationMeta(query.page, query.pageSize, total),
    };
  },

  async getById(id: string) {
    const post = await prisma.feedPost.findUnique({
      where: { id },
      include: postInclude,
    });
    if (!post) throw new NotFoundError("Post not found");
    return serializePost(post);
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

    if (existing && existing.type === type) {
      await prisma.feedReaction.delete({ where: { id: existing.id } });
      return { reacted: false, type: null };
    }

    await prisma.feedReaction.upsert({
      where: { postId_userId: { postId, userId } },
      create: { postId, userId, type },
      update: { type },
    });
    return { reacted: true, type };
  },
};
