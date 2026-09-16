import { ListingStatus, JobStatus, Prisma } from "@prisma/client";
import { prisma } from "@/infrastructure/prisma";
import { serializeProfile } from "@/shared/serializers/user.serializer";
import type { SearchQuery } from "./search.validators";

const includesType = (types: string[], type: string) =>
  types.length === 0 || types.includes(type);

export const searchService = {
  async search(userId: string, query: SearchQuery) {
    const q = query.q;
    const types = [...query.types];
    const take = query.limit;

    const [users, jobs, listings, posts, blogs] = await Promise.all([
      includesType(types, "users")
        ? prisma.user.findMany({
            where: {
              id: { not: userId },
              status: "ACTIVE",
              OR: [
                { email: { contains: q, mode: "insensitive" } },
                {
                  profile: {
                    OR: [
                      { firstName: { contains: q, mode: "insensitive" } },
                      { lastName: { contains: q, mode: "insensitive" } },
                      { company: { contains: q, mode: "insensitive" } },
                      { title: { contains: q, mode: "insensitive" } },
                    ],
                  },
                },
              ],
            },
            include: { profile: true },
            take,
          })
        : Promise.resolve([]),
      includesType(types, "jobs")
        ? prisma.job.findMany({
            where: {
              status: JobStatus.OPEN,
              OR: [
                { title: { contains: q, mode: "insensitive" } },
                { company: { contains: q, mode: "insensitive" } },
                { location: { contains: q, mode: "insensitive" } },
              ],
            },
            take,
            orderBy: { createdAt: "desc" },
          })
        : Promise.resolve([]),
      includesType(types, "listings")
        ? prisma.listing.findMany({
            where: {
              status: ListingStatus.ACTIVE,
              OR: [
                { title: { contains: q, mode: "insensitive" } },
                { description: { contains: q, mode: "insensitive" } },
                { location: { contains: q, mode: "insensitive" } },
              ],
            },
            take,
            orderBy: { createdAt: "desc" },
          })
        : Promise.resolve([]),
      includesType(types, "posts")
        ? prisma.feedPost.findMany({
            where: {
              content: { contains: q, mode: "insensitive" },
            },
            include: { author: { include: { profile: true } } },
            take,
            orderBy: { createdAt: "desc" },
          })
        : Promise.resolve([]),
      includesType(types, "blogs")
        ? prisma.blog.findMany({
            where: {
              publishedAt: { not: null },
              OR: [
                { title: { contains: q, mode: "insensitive" } },
                { excerpt: { contains: q, mode: "insensitive" } },
                { category: { contains: q, mode: "insensitive" } },
              ],
            },
            take,
            orderBy: { publishedAt: "desc" },
          })
        : Promise.resolve([]),
    ]);

    return {
      query: q,
      users: users.map((u) => ({
        id: u.id,
        role: u.role,
        ...(u.profile ? serializeProfile(u.profile) : {}),
      })),
      jobs: jobs.map((j) => ({
        id: j.id,
        title: j.title,
        company: j.company,
        location: j.location,
        level: j.level,
      })),
      listings: listings.map((l) => ({
        id: l.id,
        title: l.title,
        category: l.category,
        price: l.price / 100,
        location: l.location,
      })),
      posts: posts.map((p) => ({
        id: p.id,
        type: p.type,
        content: p.content.slice(0, 200),
        authorId: p.authorId,
        author: p.author.profile
          ? serializeProfile(p.author.profile)
          : { name: p.author.email },
      })),
      blogs: blogs.map((b) => ({
        id: b.id,
        slug: b.slug,
        title: b.title,
        category: b.category,
        excerpt: b.excerpt,
      })),
    };
  },
};

// Silence unused import if Prisma only used for types elsewhere
void (null as unknown as Prisma.UserWhereInput);
