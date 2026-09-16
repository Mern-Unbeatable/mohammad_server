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
    return serialize(report);
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
