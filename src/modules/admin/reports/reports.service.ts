import {
  ModerationAction,
  Prisma,
  ReportStatus,
  ReportTargetType,
  UserStatus,
} from "@prisma/client";
import { prisma } from "@/infrastructure/prisma";
import { NotFoundError } from "@/shared/errors/AppError";
import { buildPaginationMeta } from "@/shared/http/apiResponse";
import { toPrismaPagination } from "@/shared/http/pagination";
import { serializeProfile } from "@/shared/serializers/user.serializer";
import type { ReportListQuery } from "./reports.validators";

const STATUS_MAP: Record<string, ReportStatus> = {
  pending: ReportStatus.PENDING,
  under_review: ReportStatus.UNDER_REVIEW,
  resolved: ReportStatus.RESOLVED,
};

const include = {
  reporter: { include: { profile: true } },
  reportedUser: { include: { profile: true } },
  moderationLogs: {
    include: { actor: { include: { profile: true } } },
    orderBy: { createdAt: "desc" as const },
  },
} satisfies Prisma.ReportInclude;

type Payload = Prisma.ReportGetPayload<{ include: typeof include }>;

const person = (u: Payload["reporter"] | null) =>
  u
    ? {
        id: u.id,
        email: u.email,
        status: u.status,
        warnings: u.warnings,
        ...(u.profile ? serializeProfile(u.profile) : {}),
      }
    : null;

const serialize = (report: Payload) => ({
  id: report.id,
  targetType: report.targetType,
  targetId: report.targetId,
  targetSnippet: report.targetSnippet,
  reason: report.reason,
  reasonDetail: report.reasonDetail,
  status: report.status,
  resolvedAt: report.resolvedAt,
  createdAt: report.createdAt,
  reporter: person(report.reporter),
  reportedUser: person(report.reportedUser),
  moderationLogs: report.moderationLogs.map((m) => ({
    id: m.id,
    action: m.action,
    note: m.note,
    createdAt: m.createdAt,
    actor: person(m.actor),
  })),
});

const authorFromUser = (
  user: {
    id: string;
    email: string;
    profile?: {
      firstName: string;
      lastName: string;
      avatarUrl: string | null;
      initials: string | null;
      company: string | null;
    } | null;
  } | null,
) => {
  if (!user) return null;
  const name =
    [user.profile?.firstName, user.profile?.lastName].filter(Boolean).join(" ").trim() ||
    user.email;
  return {
    id: user.id,
    name,
    avatar: user.profile?.avatarUrl ?? null,
    initials:
      user.profile?.initials ||
      name
        .split(" ")
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase())
        .join("") ||
      "U",
    company: user.profile?.company ?? null,
  };
};

/** Load the live reported entity so admins can review the exact content. */
async function resolveTarget(
  targetType: ReportTargetType,
  targetId: string | null,
  reportedUserId: string | null,
  snippet: string | null,
) {
  const fallback = {
    type: targetType,
    id: targetId,
    exists: false,
    title: null as string | null,
    body: snippet,
    imageUrl: null as string | null,
    images: [] as string[],
    meta: null as string | null,
    href: null as string | null,
    author: null as ReturnType<typeof authorFromUser>,
  };

  if (targetType === ReportTargetType.USER) {
    const id = targetId || reportedUserId;
    if (!id) return { ...fallback, id: null };
    const user = await prisma.user.findUnique({
      where: { id },
      include: { profile: true },
    });
    if (!user) return { ...fallback, id, title: "User unavailable" };
    const author = authorFromUser(user);
    return {
      ...fallback,
      id,
      exists: true,
      title: author?.name || user.email,
      body: user.profile?.about || snippet,
      imageUrl: user.profile?.avatarUrl ?? null,
      meta: [user.profile?.company, user.email].filter(Boolean).join(" · ") || null,
      href: `/admin/users/${id}`,
      author,
    };
  }

  if (!targetId) return fallback;

  if (targetType === ReportTargetType.POST) {
    const post = await prisma.feedPost.findUnique({
      where: { id: targetId },
      include: { author: { include: { profile: true } } },
    });
    if (!post) return { ...fallback, title: "Post unavailable" };
    return {
      ...fallback,
      exists: true,
      title: "Feed post",
      body: post.content || snippet,
      imageUrl: post.imageUrl || post.imageUrls[0] || null,
      images: post.imageUrls || [],
      meta: post.type,
      href: null,
      author: authorFromUser(post.author),
    };
  }

  if (targetType === ReportTargetType.COMMENT) {
    const comment = await prisma.feedComment.findUnique({
      where: { id: targetId },
      include: {
        author: { include: { profile: true } },
        post: { select: { id: true, content: true } },
      },
    });
    if (!comment) return { ...fallback, title: "Comment unavailable" };
    return {
      ...fallback,
      exists: true,
      title: "Feed comment",
      body: comment.content || snippet,
      meta: comment.post?.content
        ? `On post: ${comment.post.content.slice(0, 120)}`
        : null,
      href: null,
      author: authorFromUser(comment.author),
    };
  }

  if (targetType === ReportTargetType.LISTING) {
    const listing = await prisma.listing.findUnique({
      where: { id: targetId },
      include: { seller: { include: { profile: true } } },
    });
    if (!listing) return { ...fallback, title: "Listing unavailable" };
    return {
      ...fallback,
      exists: true,
      title: listing.title,
      body: listing.description || snippet,
      imageUrl: listing.images[0] || null,
      images: listing.images || [],
      meta: [
        listing.category,
        listing.condition,
        listing.location,
        `€${(listing.price / 100).toFixed(0)}`,
      ]
        .filter(Boolean)
        .join(" · "),
      href: `/admin/marketplace/${listing.id}`,
      author: authorFromUser(listing.seller),
    };
  }

  if (targetType === ReportTargetType.JOB) {
    const job = await prisma.job.findUnique({
      where: { id: targetId },
      include: { owner: { include: { profile: true } } },
    });
    if (!job) return { ...fallback, title: "Job unavailable" };
    return {
      ...fallback,
      exists: true,
      title: job.title,
      body: job.about || snippet,
      imageUrl: job.imageUrl,
      meta: [job.company, job.location, job.employmentType, job.salary]
        .filter(Boolean)
        .join(" · "),
      href: `/admin/recruitment/${job.id}`,
      author: authorFromUser(job.owner),
    };
  }

  if (targetType === ReportTargetType.GENERAL_POST) {
    const post = await prisma.generalPost.findUnique({
      where: { id: targetId },
      include: { author: { include: { profile: true } } },
    });
    if (!post) return { ...fallback, title: "General post unavailable" };
    return {
      ...fallback,
      exists: true,
      title: post.title,
      body: post.summary || post.body?.join("\n\n") || snippet,
      imageUrl: post.imageUrl,
      meta: [post.type, post.category, post.source].filter(Boolean).join(" · "),
      href: `/admin/general/${post.id}`,
      author: authorFromUser(post.author),
    };
  }

  return fallback;
}

export const reportsService = {
  async create(
    reporterId: string,
    input: {
      targetType: ReportTargetType;
      targetId?: string;
      reportedUserId?: string;
      targetSnippet?: string;
      reason: Payload["reason"];
      reasonDetail?: string;
    },
  ) {
    const report = await prisma.report.create({
      data: { reporterId, ...input },
      include,
    });
    return serialize(report);
  },

  async list(query: ReportListQuery) {
    const { skip, take } = toPrismaPagination(query.page, query.pageSize);
    const where: Prisma.ReportWhereInput = {
      ...(query.status ? { status: STATUS_MAP[query.status] } : {}),
      ...(query.search
        ? {
            OR: [
              {
                targetSnippet: { contains: query.search, mode: "insensitive" },
              },
              { reasonDetail: { contains: query.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const [rows, total] = await prisma.$transaction([
      prisma.report.findMany({
        where,
        include,
        orderBy: { createdAt: query.sort },
        skip,
        take,
      }),
      prisma.report.count({ where }),
    ]);

    return {
      data: rows.map(serialize),
      meta: buildPaginationMeta(query.page, query.pageSize, total),
    };
  },

  /** Reports filed by the current user. */
  async listMine(reporterId: string, query: ReportListQuery) {
    const { skip, take } = toPrismaPagination(query.page, query.pageSize);
    const where: Prisma.ReportWhereInput = {
      reporterId,
      ...(query.status ? { status: STATUS_MAP[query.status] } : {}),
      ...(query.search
        ? {
            OR: [
              {
                targetSnippet: { contains: query.search, mode: "insensitive" },
              },
              { reasonDetail: { contains: query.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const [rows, total] = await prisma.$transaction([
      prisma.report.findMany({
        where,
        include,
        orderBy: { createdAt: query.sort },
        skip,
        take,
      }),
      prisma.report.count({ where }),
    ]);

    return {
      data: rows.map(serialize),
      meta: buildPaginationMeta(query.page, query.pageSize, total),
    };
  },

  async getById(id: string) {
    const report = await prisma.report.findUnique({ where: { id }, include });
    if (!report) throw new NotFoundError("Report not found");
    const target = await resolveTarget(
      report.targetType,
      report.targetId,
      report.reportedUserId,
      report.targetSnippet,
    );
    return { ...serialize(report), target };
  },

  async stats() {
    const [total, pending, review, resolved] = await prisma.$transaction([
      prisma.report.count(),
      prisma.report.count({ where: { status: ReportStatus.PENDING } }),
      prisma.report.count({ where: { status: ReportStatus.UNDER_REVIEW } }),
      prisma.report.count({ where: { status: ReportStatus.RESOLVED } }),
    ]);
    return { total, pending, review, resolved };
  },

  async updateStatus(id: string, status: ReportStatus) {
    const report = await prisma.report.findUnique({ where: { id } });
    if (!report) throw new NotFoundError("Report not found");
    const updated = await prisma.report.update({
      where: { id },
      data: {
        status,
        resolvedAt: status === ReportStatus.RESOLVED ? new Date() : null,
      },
      include,
    });
    return serialize(updated);
  },

  /** Applies a moderation action against the reported user and logs it. */
  async moderate(
    actorId: string,
    reportId: string,
    action: ModerationAction,
    note?: string,
  ) {
    const report = await prisma.report.findUnique({ where: { id: reportId } });
    if (!report) throw new NotFoundError("Report not found");

    const ops: Prisma.PrismaPromise<unknown>[] = [];

    if (report.reportedUserId) {
      if (action === ModerationAction.WARN) {
        ops.push(
          prisma.user.update({
            where: { id: report.reportedUserId },
            data: { warnings: { increment: 1 } },
          }),
        );
      }
      if (action === ModerationAction.SUSPEND) {
        ops.push(
          prisma.user.update({
            where: { id: report.reportedUserId },
            data: { status: UserStatus.SUSPENDED },
          }),
        );
      }
      if (action === ModerationAction.BAN) {
        ops.push(
          prisma.user.update({
            where: { id: report.reportedUserId },
            data: { status: UserStatus.BANNED },
          }),
        );
      }
    }

    ops.push(
      prisma.moderationLog.create({
        data: {
          reportId,
          actorId,
          targetUserId: report.reportedUserId,
          action,
          note,
        },
      }),
    );

    // Any action other than a pure dismiss resolves the report.
    ops.push(
      prisma.report.update({
        where: { id: reportId },
        data: { status: ReportStatus.RESOLVED, resolvedAt: new Date() },
      }),
    );

    if (report.reportedUserId) {
      ops.push(
        prisma.notification.create({
          data: {
            userId: report.reportedUserId,
            type: "REPORT_UPDATE",
            title: "Moderation update",
            subtitle: `Action taken on your account: ${action}`,
          },
        }),
      );
    }

    await prisma.$transaction(ops);
    return this.getById(reportId);
  },
};
