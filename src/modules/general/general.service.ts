import { GeneralPostType, Prisma } from "@prisma/client";
import { prisma } from "@/infrastructure/prisma";
import { ForbiddenError, NotFoundError } from "@/shared/errors/AppError";
import { buildPaginationMeta } from "@/shared/http/apiResponse";
import { toPrismaPagination } from "@/shared/http/pagination";
import { serializeProfile } from "@/shared/serializers/user.serializer";

const include = {
  author: { include: { profile: true } },
} satisfies Prisma.GeneralPostInclude;
type Payload = Prisma.GeneralPostGetPayload<{ include: typeof include }>;

const TYPE_MAP: Record<string, GeneralPostType> = {
  news: GeneralPostType.NEWS,
  document: GeneralPostType.DOCUMENT,
};

const serialize = (post: Payload) => ({
  id: post.id,
  type: post.type,
  title: post.title,
  summary: post.summary,
  category: post.category,
  source: post.source,
  imageUrl: post.imageUrl,
  documentUrl: post.documentUrl,
  body: post.body,
  date: post.createdAt,
  author: {
    id: post.author.id,
    ...(post.author.profile ? serializeProfile(post.author.profile) : {}),
  },
});

export const generalService = {
  async list(
    userId: string,
    query: {
      page: number;
      pageSize: number;
      sort: "asc" | "desc";
      type?: string;
      mine?: boolean;
      search?: string;
    },
  ) {
    const { skip, take } = toPrismaPagination(query.page, query.pageSize);
    const where: Prisma.GeneralPostWhereInput = {
      ...(query.type ? { type: TYPE_MAP[query.type] } : {}),
      ...(query.mine ? { authorId: userId } : {}),
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: "insensitive" } },
              { summary: { contains: query.search, mode: "insensitive" } },
              { category: { contains: query.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const [rows, total] = await prisma.$transaction([
      prisma.generalPost.findMany({
        where,
        include,
        orderBy: { createdAt: query.sort },
        skip,
        take,
      }),
      prisma.generalPost.count({ where }),
    ]);

    return {
      data: rows.map(serialize),
      meta: buildPaginationMeta(query.page, query.pageSize, total),
    };
  },

  async getById(id: string) {
    const post = await prisma.generalPost.findUnique({
      where: { id },
      include,
    });
    if (!post) throw new NotFoundError("Post not found");
    return serialize(post);
  },

  async create(
    authorId: string,
    input: Omit<Prisma.GeneralPostCreateInput, "author">,
  ) {
    const post = await prisma.generalPost.create({
      data: { ...input, author: { connect: { id: authorId } } },
      include,
    });
    return serialize(post);
  },

  async update(
    userId: string,
    role: string,
    id: string,
    input: Prisma.GeneralPostUpdateInput,
  ) {
    const post = await prisma.generalPost.findUnique({ where: { id } });
    if (!post) throw new NotFoundError("Post not found");
    if (post.authorId !== userId && role !== "ADMIN") {
      throw new ForbiddenError("You can only edit your own posts");
    }
    const updated = await prisma.generalPost.update({
      where: { id },
      data: input,
      include,
    });
    return serialize(updated);
  },

  async remove(userId: string, role: string, id: string) {
    const post = await prisma.generalPost.findUnique({ where: { id } });
    if (!post) throw new NotFoundError("Post not found");
    if (post.authorId !== userId && role !== "ADMIN") {
      throw new ForbiddenError("You can only delete your own posts");
    }
    await prisma.generalPost.delete({ where: { id } });
  },
};
