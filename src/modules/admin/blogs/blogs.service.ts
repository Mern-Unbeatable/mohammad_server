import { Prisma } from "@prisma/client";
import { prisma } from "@/infrastructure/prisma";
import { NotFoundError } from "@/shared/errors/AppError";
import { buildPaginationMeta } from "@/shared/http/apiResponse";
import { toPrismaPagination } from "@/shared/http/pagination";
import { slugify } from "@/shared/utils/text";
import type { BlogListQuery } from "./blogs.validators";

const include = {
  author: { include: { profile: true } },
} satisfies Prisma.BlogInclude;
type Payload = Prisma.BlogGetPayload<{ include: typeof include }>;

const serialize = (blog: Payload) => ({
  id: blog.id,
  slug: blog.slug,
  category: blog.category,
  title: blog.title,
  excerpt: blog.excerpt,
  image: blog.image,
  readTime: blog.readTime,
  body: blog.body,
  date: blog.publishedAt ?? blog.createdAt,
  publishedAt: blog.publishedAt,
  author: blog.author.profile
    ? `${blog.author.profile.firstName} ${blog.author.profile.lastName}`.trim()
    : blog.author.email,
  authorInitials: blog.author.profile?.initials ?? null,
});

/** Ensures a unique slug by appending a counter when collisions occur. */
const uniqueSlug = async (base: string, ignoreId?: string): Promise<string> => {
  const root = slugify(base) || "article";
  let candidate = root;
  let counter = 1;
  while (true) {
    const existing = await prisma.blog.findUnique({
      where: { slug: candidate },
    });
    if (!existing || existing.id === ignoreId) return candidate;
    candidate = `${root}-${counter++}`;
  }
};

export const blogsService = {
  async list(query: BlogListQuery, includeUnpublished = false) {
    const { skip, take } = toPrismaPagination(query.page, query.pageSize);
    const where: Prisma.BlogWhereInput = {
      ...(includeUnpublished ? {} : { publishedAt: { not: null } }),
      ...(query.category ? { category: query.category } : {}),
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: "insensitive" } },
              { excerpt: { contains: query.search, mode: "insensitive" } },
              { category: { contains: query.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const [rows, total] = await prisma.$transaction([
      prisma.blog.findMany({
        where,
        include,
        orderBy: { createdAt: query.sort },
        skip,
        take,
      }),
      prisma.blog.count({ where }),
    ]);

    return {
      data: rows.map(serialize),
      meta: buildPaginationMeta(query.page, query.pageSize, total),
    };
  },

  async getBySlug(slug: string) {
    const blog = await prisma.blog.findUnique({ where: { slug }, include });
    if (!blog) throw new NotFoundError("Article not found");
    return serialize(blog);
  },

  async create(
    authorId: string,
    input: {
      title: string;
      category: string;
      excerpt: string;
      body: string;
      image?: string;
      readTime?: string;
      slug?: string;
      publish?: boolean;
    },
  ) {
    const slug = await uniqueSlug(input.slug ?? input.title);
    const blog = await prisma.blog.create({
      data: {
        authorId,
        slug,
        title: input.title,
        category: input.category,
        excerpt: input.excerpt,
        body: input.body,
        image: input.image,
        readTime: input.readTime,
        publishedAt: input.publish === false ? null : new Date(),
      },
      include,
    });
    return serialize(blog);
  },

  async update(id: string, input: Record<string, unknown>) {
    const blog = await prisma.blog.findUnique({ where: { id } });
    if (!blog) throw new NotFoundError("Article not found");

    const data: Prisma.BlogUpdateInput = { ...input };
    delete (data as Record<string, unknown>).publish;
    if (typeof input.slug === "string")
      data.slug = await uniqueSlug(input.slug, id);
    if (typeof input.publish === "boolean") {
      data.publishedAt = input.publish
        ? (blog.publishedAt ?? new Date())
        : null;
    }

    const updated = await prisma.blog.update({ where: { id }, data, include });
    return serialize(updated);
  },

  async remove(id: string) {
    const blog = await prisma.blog.findUnique({ where: { id } });
    if (!blog) throw new NotFoundError("Article not found");
    await prisma.blog.delete({ where: { id } });
  },
};
