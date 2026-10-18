import { JobStatus, Prisma } from "@prisma/client";
import { prisma } from "@/infrastructure/prisma";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "@/shared/errors/AppError";
import { buildPaginationMeta } from "@/shared/http/apiResponse";
import { toPrismaPagination } from "@/shared/http/pagination";
import { serializeProfile } from "@/shared/serializers/user.serializer";
import type { JobListQuery } from "./recruitment.validators";

const jobInclude = {
  owner: { include: { profile: true } },
  _count: { select: { applications: true } },
} satisfies Prisma.JobInclude;

type JobPayload = Prisma.JobGetPayload<{ include: typeof jobInclude }>;

const sinceToDate = (since?: string): Date | undefined => {
  if (!since) return undefined;
  const days = since === "7d" ? 7 : since === "30d" ? 30 : 90;
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
};

const serializeJob = (job: JobPayload) => ({
  id: job.id,
  title: job.title,
  company: job.company,
  location: job.location,
  employmentType: job.employmentType,
  workplaceType: job.workplaceType,
  level: job.level,
  salary: job.salary,
  applyLink: job.applyLink,
  imageUrl: job.imageUrl,
  about: job.about,
  requirements: job.requirements,
  status: job.status,
  postedAt: job.createdAt,
  applicationsCount: job._count.applications,
  owner: {
    id: job.owner.id,
    ...(job.owner.profile ? serializeProfile(job.owner.profile) : {}),
  },
});

const isAdmin = (role: string) => role === "ADMIN";

/**
 * `mine` lists every job the caller owns, optionally narrowed by status.
 * Otherwise only OPEN jobs are listed, and non-admins never see their own
 * posts there so a job is not listed in both sections.
 */
const listScope = (
  userId: string,
  role: string,
  query: JobListQuery,
): Prisma.JobWhereInput => {
  if (query.mine) {
    return {
      ownerId: userId,
      ...(query.status ? { status: query.status } : {}),
    };
  }
  return {
    status: JobStatus.OPEN,
    ...(isAdmin(role) ? {} : { ownerId: { not: userId } }),
  };
};

export const recruitmentService = {
  async list(userId: string, role: string, query: JobListQuery) {
    const { skip, take } = toPrismaPagination(query.page, query.pageSize);
    const since = sinceToDate(query.since);

    const where: Prisma.JobWhereInput = {
      ...listScope(userId, role, query),
      ...(query.level ? { level: query.level } : {}),
      ...(query.employmentType ? { employmentType: query.employmentType } : {}),
      ...(since ? { createdAt: { gte: since } } : {}),
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: "insensitive" } },
              { company: { contains: query.search, mode: "insensitive" } },
              { location: { contains: query.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const [rows, total] = await prisma.$transaction([
      prisma.job.findMany({
        where,
        include: jobInclude,
        // `id` breaks createdAt ties so offset pages never overlap or skip rows.
        orderBy: [{ createdAt: query.sort }, { id: query.sort }],
        skip,
        take,
      }),
      prisma.job.count({ where }),
    ]);

    return {
      data: rows.map(serializeJob),
      meta: buildPaginationMeta(query.page, query.pageSize, total),
    };
  },

  async getById(userId: string, role: string, id: string) {
    const job = await prisma.job.findUnique({
      where: { id },
      include: jobInclude,
    });
    const hidden =
      job?.status === JobStatus.REMOVED &&
      job.ownerId !== userId &&
      !isAdmin(role);
    if (!job || hidden) throw new NotFoundError("Job not found");

    const myApplication = await prisma.jobApplication.findUnique({
      where: { jobId_applicantId: { jobId: id, applicantId: userId } },
      select: { id: true, status: true, createdAt: true },
    });

    return {
      ...serializeJob(job),
      myApplication: myApplication
        ? {
            id: myApplication.id,
            status: myApplication.status,
            appliedAt: myApplication.createdAt,
          }
        : null,
    };
  },

  async create(ownerId: string, input: Prisma.JobCreateWithoutOwnerInput) {
    const job = await prisma.job.create({
      data: { ...input, owner: { connect: { id: ownerId } } },
      include: jobInclude,
    });
    return serializeJob(job);
  },

  async update(
    userId: string,
    role: string,
    id: string,
    input: Prisma.JobUpdateInput,
  ) {
    const job = await prisma.job.findUnique({ where: { id } });
    if (!job) throw new NotFoundError("Job not found");
    if (job.ownerId !== userId && !isAdmin(role)) {
      throw new ForbiddenError("You can only edit your own job postings");
    }
    const changesStatus = input.status !== undefined && input.status !== job.status;
    const touchesRemoved =
      input.status === JobStatus.REMOVED || job.status === JobStatus.REMOVED;
    if (changesStatus && touchesRemoved && !isAdmin(role)) {
      throw new ForbiddenError(
        "Only an administrator can remove or restore a job posting",
      );
    }
    const updated = await prisma.job.update({
      where: { id },
      data: input,
      include: jobInclude,
    });
    return serializeJob(updated);
  },

  async remove(userId: string, role: string, id: string) {
    const job = await prisma.job.findUnique({ where: { id } });
    if (!job) throw new NotFoundError("Job not found");
    if (job.ownerId !== userId && role !== "ADMIN") {
      throw new ForbiddenError("You can only delete your own job postings");
    }
    await prisma.job.delete({ where: { id } });
  },

  async apply(jobId: string, applicantId: string, coverLetter?: string) {
    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundError("Job not found");
    if (job.status !== JobStatus.OPEN)
      throw new ConflictError("This job is no longer open");
    if (job.ownerId === applicantId) {
      throw new ConflictError("You cannot apply to your own job posting");
    }

    const existing = await prisma.jobApplication.findUnique({
      where: { jobId_applicantId: { jobId, applicantId } },
    });
    if (existing)
      throw new ConflictError("You have already applied to this job");

    const application = await prisma.jobApplication.create({
      data: { jobId, applicantId, coverLetter },
    });

    await prisma.notification.create({
      data: {
        userId: job.ownerId,
        type: "JOB_APPLICATION",
        title: "New job application",
        subtitle: `Someone applied to ${job.title}`,
        link: `/recruitment/${jobId}`,
      },
    });

    return application;
  },

  async listApplications(ownerId: string, role: string, jobId: string) {
    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundError("Job not found");
    if (job.ownerId !== ownerId && role !== "ADMIN") {
      throw new ForbiddenError(
        "You can only view applications for your own jobs",
      );
    }
    const applications = await prisma.jobApplication.findMany({
      where: { jobId },
      include: { applicant: { include: { profile: true } } },
      orderBy: { createdAt: "desc" },
    });
    const isOwner = job.ownerId === ownerId;
    if (isOwner && applications.some((a) => !a.ownerSeenAt)) {
      await prisma.jobApplication.updateMany({
        where: { jobId, ownerSeenAt: null },
        data: { ownerSeenAt: new Date() },
      });
    }
    return applications.map((a) => ({
      id: a.id,
      status: a.status,
      coverLetter: a.coverLetter,
      appliedAt: a.createdAt,
      isNew: isOwner && !a.ownerSeenAt,
      applicant: {
        id: a.applicant.id,
        email: a.applicant.email,
        ...(a.applicant.profile ? serializeProfile(a.applicant.profile) : {}),
      },
    }));
  },

  /** Applications on the caller's jobs they have not opened yet, per job. */
  async newApplicationCounts(ownerId: string) {
    const rows = await prisma.jobApplication.groupBy({
      by: ["jobId"],
      where: { ownerSeenAt: null, job: { ownerId } },
      _count: { _all: true },
    });
    const byJob: Record<string, number> = {};
    let total = 0;
    for (const row of rows) {
      byJob[row.jobId] = row._count._all;
      total += row._count._all;
    }
    return { total, byJob };
  },

  /** Applications submitted by the current user (applicant view). */
  async listMyApplications(
    applicantId: string,
    query: { page: number; pageSize: number; sort: "asc" | "desc" },
  ) {
    const { skip, take } = toPrismaPagination(query.page, query.pageSize);
    const where = { applicantId };

    const [rows, total] = await prisma.$transaction([
      prisma.jobApplication.findMany({
        where,
        include: {
          job: { include: jobInclude },
        },
        orderBy: { createdAt: query.sort },
        skip,
        take,
      }),
      prisma.jobApplication.count({ where }),
    ]);

    return {
      data: rows.map((a) => ({
        id: a.id,
        status: a.status,
        coverLetter: a.coverLetter,
        appliedAt: a.createdAt,
        job: serializeJob(a.job),
      })),
      meta: buildPaginationMeta(query.page, query.pageSize, total),
    };
  },
};
