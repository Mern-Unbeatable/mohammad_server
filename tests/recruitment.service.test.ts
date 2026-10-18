import { beforeEach, describe, expect, it, vi } from "vitest";
import { JobStatus } from "@prisma/client";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    job: {
      findMany: vi.fn(),
      count: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    jobApplication: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
      groupBy: vi.fn(),
      delete: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/infrastructure/prisma", () => ({ prisma: prismaMock }));

import { recruitmentService } from "@/modules/user/recruitment/recruitment.service";
import {
  createJobSchema,
  jobListQuerySchema,
  updateJobSchema,
} from "@/modules/user/recruitment/recruitment.validators";

const job = (overrides: Record<string, unknown> = {}) => ({
  id: "job1",
  title: "Lab Technician",
  company: "Acme",
  location: "Dhaka",
  employmentType: "FULL_TIME",
  workplaceType: "ON_SITE",
  level: "MID_LEVEL",
  salary: null,
  applyLink: null,
  imageUrl: null,
  about: "About",
  requirements: [],
  status: JobStatus.OPEN,
  ownerId: "owner",
  createdAt: new Date(),
  owner: { id: "owner", profile: null },
  _count: { applications: 0 },
  ...overrides,
});

const listQuery = (overrides: Record<string, unknown> = {}) =>
  jobListQuerySchema.parse({ page: "1", pageSize: "10", ...overrides });

const listWhere = () => prismaMock.job.findMany.mock.calls[0][0].where;

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.job.findMany.mockReturnValue("findMany");
  prismaMock.job.count.mockReturnValue("count");
  prismaMock.$transaction.mockResolvedValue([[], 0]);
});

describe("jobListQuerySchema", () => {
  it("parses mine=false as false instead of coercing it to true", () => {
    expect(listQuery({ mine: "false" }).mine).toBe(false);
    expect(listQuery({ mine: "true" }).mine).toBe(true);
    expect(listQuery().mine).toBeUndefined();
  });

  it("rejects unknown status values", () => {
    expect(() => listQuery({ status: "DRAFT" })).toThrow();
  });
});

describe("job workplace type", () => {
  const base = {
    title: "T",
    company: "C",
    location: "L",
    employmentType: "FULL_TIME",
    level: "SENIOR",
    about: "A",
  };

  it("accepts On-site, Remote and Hybrid and leaves it optional", () => {
    for (const workplaceType of ["ON_SITE", "REMOTE", "HYBRID"]) {
      expect(createJobSchema.parse({ ...base, workplaceType }).workplaceType).toBe(workplaceType);
    }
    expect(createJobSchema.parse(base).workplaceType).toBeUndefined();
    expect(() => createJobSchema.parse({ ...base, workplaceType: "OFFICE" })).toThrow();
  });

  it("lets an edit remove the job image with null, but not on create", () => {
    expect(updateJobSchema.parse({ imageUrl: null }).imageUrl).toBeNull();
    expect(() => createJobSchema.parse({ ...base, imageUrl: null })).toThrow();
  });

  it("is returned on the job", async () => {
    prismaMock.job.findUnique.mockResolvedValue(job({ workplaceType: "REMOTE" }));
    prismaMock.jobApplication.findUnique.mockResolvedValue(null);
    const result = await recruitmentService.getById("me", "USER", "job1");
    expect(result.workplaceType).toBe("REMOTE");
  });
});

describe("recruitmentService.list", () => {
  it("lists only other members' OPEN jobs in the public section", async () => {
    await recruitmentService.list("me", "USER", listQuery({ status: "CLOSED" }));
    expect(listWhere()).toMatchObject({
      status: JobStatus.OPEN,
      ownerId: { not: "me" },
    });
  });

  it("treats mine=false as the public section", async () => {
    await recruitmentService.list("me", "SUPPLIER", listQuery({ mine: "false" }));
    expect(listWhere()).toMatchObject({
      status: JobStatus.OPEN,
      ownerId: { not: "me" },
    });
  });

  it("keeps admins' own OPEN jobs in the public list", async () => {
    await recruitmentService.list("admin", "ADMIN", listQuery());
    expect(listWhere().status).toBe(JobStatus.OPEN);
    expect(listWhere().ownerId).toBeUndefined();
  });

  it("lists every status of the caller's own jobs under mine", async () => {
    await recruitmentService.list("me", "USER", listQuery({ mine: "true" }));
    expect(listWhere().ownerId).toBe("me");
    expect(listWhere().status).toBeUndefined();
  });

  it("narrows my jobs by status", async () => {
    await recruitmentService.list(
      "me",
      "USER",
      listQuery({ mine: "true", status: "CLOSED" }),
    );
    expect(listWhere()).toMatchObject({
      ownerId: "me",
      status: JobStatus.CLOSED,
    });
  });

  it("paginates with a stable tie-breaker", async () => {
    prismaMock.$transaction.mockResolvedValue([[job()], 11]);
    const result = await recruitmentService.list(
      "me",
      "USER",
      listQuery({ page: "2", pageSize: "5" }),
    );
    const args = prismaMock.job.findMany.mock.calls[0][0];
    expect(args.skip).toBe(5);
    expect(args.take).toBe(5);
    expect(args.orderBy).toEqual([{ createdAt: "desc" }, { id: "desc" }]);
    expect(result.meta).toMatchObject({ page: 2, total: 11, totalPages: 3 });
  });
});

describe("recruitmentService.getById", () => {
  it("hides removed jobs from other members", async () => {
    prismaMock.job.findUnique.mockResolvedValue(
      job({ status: JobStatus.REMOVED }),
    );
    await expect(
      recruitmentService.getById("someone", "USER", "job1"),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("shows removed jobs to the owner and admins", async () => {
    prismaMock.job.findUnique.mockResolvedValue(
      job({ status: JobStatus.REMOVED }),
    );
    await expect(
      recruitmentService.getById("owner", "USER", "job1"),
    ).resolves.toMatchObject({ status: JobStatus.REMOVED });
    await expect(
      recruitmentService.getById("admin", "ADMIN", "job1"),
    ).resolves.toMatchObject({ id: "job1" });
  });

  it("includes the caller's own application", async () => {
    const appliedAt = new Date("2026-10-01");
    prismaMock.job.findUnique.mockResolvedValue(job());
    prismaMock.jobApplication.findUnique.mockResolvedValue({
      id: "app1",
      status: "APPLIED",
      createdAt: appliedAt,
    });
    await expect(
      recruitmentService.getById("someone", "USER", "job1"),
    ).resolves.toMatchObject({
      myApplication: { id: "app1", status: "APPLIED", appliedAt },
    });
    expect(prismaMock.jobApplication.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { jobId_applicantId: { jobId: "job1", applicantId: "someone" } },
      }),
    );
  });

  it("returns myApplication null when the caller has not applied", async () => {
    prismaMock.job.findUnique.mockResolvedValue(job());
    prismaMock.jobApplication.findUnique.mockResolvedValue(null);
    await expect(
      recruitmentService.getById("someone", "USER", "job1"),
    ).resolves.toMatchObject({ myApplication: null });
  });

  it("still shows closed jobs to anyone", async () => {
    prismaMock.job.findUnique.mockResolvedValue(
      job({ status: JobStatus.CLOSED }),
    );
    await expect(
      recruitmentService.getById("someone", "USER", "job1"),
    ).resolves.toMatchObject({ status: JobStatus.CLOSED });
  });
});

describe("recruitmentService.update status rules", () => {
  it("lets the owner close and reopen a job", async () => {
    prismaMock.job.findUnique.mockResolvedValue(job());
    prismaMock.job.update.mockResolvedValue(job({ status: JobStatus.CLOSED }));
    await expect(
      recruitmentService.update("owner", "USER", "job1", {
        status: JobStatus.CLOSED,
      }),
    ).resolves.toMatchObject({ status: JobStatus.CLOSED });
  });

  it("rejects an owner marking their job as removed", async () => {
    prismaMock.job.findUnique.mockResolvedValue(job());
    await expect(
      recruitmentService.update("owner", "SUPPLIER", "job1", {
        status: JobStatus.REMOVED,
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(prismaMock.job.update).not.toHaveBeenCalled();
  });

  it("rejects an owner reopening a job an admin removed", async () => {
    prismaMock.job.findUnique.mockResolvedValue(
      job({ status: JobStatus.REMOVED }),
    );
    await expect(
      recruitmentService.update("owner", "USER", "job1", {
        status: JobStatus.OPEN,
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("lets admins remove a job", async () => {
    prismaMock.job.findUnique.mockResolvedValue(job());
    prismaMock.job.update.mockResolvedValue(job({ status: JobStatus.REMOVED }));
    await expect(
      recruitmentService.update("admin", "ADMIN", "job1", {
        status: JobStatus.REMOVED,
      }),
    ).resolves.toMatchObject({ status: JobStatus.REMOVED });
  });

  it("rejects editing someone else's job", async () => {
    prismaMock.job.findUnique.mockResolvedValue(job());
    await expect(
      recruitmentService.update("someone", "USER", "job1", { title: "x" }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe("new application badge", () => {
  const application = (id: string, ownerSeenAt: Date | null) => ({
    id,
    status: "APPLIED",
    coverLetter: null,
    createdAt: new Date(),
    ownerSeenAt,
    applicant: { id: `u-${id}`, email: `${id}@test`, profile: null },
  });

  it("counts unseen applications on the caller's jobs, per job", async () => {
    prismaMock.jobApplication.groupBy.mockResolvedValue([
      { jobId: "a", _count: { _all: 2 } },
      { jobId: "b", _count: { _all: 1 } },
    ]);
    const result = await recruitmentService.newApplicationCounts("me");
    expect(result).toEqual({ total: 3, byJob: { a: 2, b: 1 } });
    expect(prismaMock.jobApplication.groupBy.mock.calls[0][0].where).toEqual({
      ownerSeenAt: null,
      job: { ownerId: "me" },
    });
  });

  it("flags new applications for the owner and marks them seen", async () => {
    prismaMock.job.findUnique.mockResolvedValue(job());
    prismaMock.jobApplication.findMany.mockResolvedValue([
      application("new", null),
      application("old", new Date()),
    ]);
    const rows = await recruitmentService.listApplications("owner", "USER", "job1");
    expect(rows.map((r) => r.isNew)).toEqual([true, false]);
    expect(prismaMock.jobApplication.updateMany).toHaveBeenCalledWith({
      where: { jobId: "job1", ownerSeenAt: null },
      data: { ownerSeenAt: expect.any(Date) },
    });
  });

  it("does not mark applications seen when an admin views them", async () => {
    prismaMock.job.findUnique.mockResolvedValue(job());
    prismaMock.jobApplication.findMany.mockResolvedValue([application("new", null)]);
    const rows = await recruitmentService.listApplications("admin", "ADMIN", "job1");
    expect(rows[0].isNew).toBe(false);
    expect(prismaMock.jobApplication.updateMany).not.toHaveBeenCalled();
  });
});

describe("recruitmentService.withdraw", () => {
  it("deletes a pending application so the member can re-apply later", async () => {
    prismaMock.jobApplication.findUnique.mockResolvedValue({
      id: "app-1",
      status: "REVIEWED",
    });

    await expect(recruitmentService.withdraw("job-1", "me")).resolves.toEqual({
      jobId: "job-1",
      applicationId: "app-1",
    });
    expect(prismaMock.jobApplication.findUnique).toHaveBeenCalledWith({
      where: { jobId_applicantId: { jobId: "job-1", applicantId: "me" } },
    });
    expect(prismaMock.jobApplication.delete).toHaveBeenCalledWith({
      where: { id: "app-1" },
    });
  });

  it("keeps accepted or rejected applications", async () => {
    prismaMock.jobApplication.findUnique.mockResolvedValue({
      id: "app-1",
      status: "ACCEPTED",
    });

    await expect(recruitmentService.withdraw("job-1", "me")).rejects.toThrow(
      /cannot be cancelled/,
    );
    expect(prismaMock.jobApplication.delete).not.toHaveBeenCalled();
  });

  it("fails when the member has not applied", async () => {
    prismaMock.jobApplication.findUnique.mockResolvedValue(null);

    await expect(recruitmentService.withdraw("job-1", "me")).rejects.toThrow(
      /not found/,
    );
  });
});
