import {
  AdStatus,
  ReportStatus,
  Role,
  SubscriptionStatus,
  UserStatus,
} from "@prisma/client";
import { prisma } from "@/infrastructure/prisma";

const personName = (profile?: {
  firstName?: string | null;
  lastName?: string | null;
} | null) =>
  [profile?.firstName, profile?.lastName].filter(Boolean).join(" ").trim();

const personInitials = (
  profile?: {
    firstName?: string | null;
    lastName?: string | null;
    initials?: string | null;
  } | null,
  fallback = "",
) => {
  if (profile?.initials) return profile.initials;
  const name = personName(profile) || fallback;
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
};

export const dashboardService = {
  /** Headline KPIs, attention queues, and quick snapshot for the admin home. */
  async dashboard() {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const [
      activeUsers,
      suppliers,
      newSubscribers,
      activeSubscriptions,
      pendingReports,
      pendingAds,
      newJobs,
      totalListings,
      revenueAgg,
      recentReports,
      recentAds,
    ] = await Promise.all([
      prisma.user.count({
        where: { status: UserStatus.ACTIVE, role: { not: Role.ADMIN } },
      }),
      prisma.user.count({ where: { role: Role.SUPPLIER } }),
      prisma.subscription.count({
        where: {
          status: SubscriptionStatus.ACTIVE,
          startDate: { gte: startOfMonth },
        },
      }),
      prisma.subscription.count({
        where: { status: SubscriptionStatus.ACTIVE },
      }),
      prisma.report.count({
        where: {
          status: { in: [ReportStatus.PENDING, ReportStatus.UNDER_REVIEW] },
        },
      }),
      prisma.advertisement.count({
        where: { status: AdStatus.PENDING },
      }),
      prisma.job.count({ where: { createdAt: { gte: startOfMonth } } }),
      prisma.listing.count(),
      prisma.subscription.aggregate({
        _sum: { amount: true },
        where: {
          status: SubscriptionStatus.ACTIVE,
          startDate: { gte: startOfMonth },
        },
      }),
      prisma.report.findMany({
        where: {
          status: { in: [ReportStatus.PENDING, ReportStatus.UNDER_REVIEW] },
        },
        include: {
          reporter: { include: { profile: true } },
          reportedUser: { include: { profile: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
      prisma.advertisement.findMany({
        where: { status: AdStatus.PENDING },
        include: { supplier: { include: { profile: true } } },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
    ]);

    const monthlyRevenue = (revenueAgg._sum.amount ?? 0) / 100;

    return {
      stats: [
        { id: "active-users", label: "Active Users", value: activeUsers },
        {
          id: "active-subscriptions",
          label: "Active Subscriptions",
          value: activeSubscriptions,
        },
        {
          id: "monthly-revenue",
          label: "Monthly Revenue",
          value: monthlyRevenue,
          currency: "EUR",
        },
        {
          id: "pending-reports",
          label: "Pending Reports",
          value: pendingReports,
        },
        { id: "pending-ads", label: "Ads to Review", value: pendingAds },
        { id: "suppliers", label: "Suppliers", value: suppliers },
      ],
      attention: {
        reports: recentReports.map((report) => {
          const reportedName = report.reportedUser
            ? personName(report.reportedUser.profile) ||
              report.reportedUser.email
            : null;
          const reporterName =
            personName(report.reporter.profile) || report.reporter.email;
          const avatarUser = report.reportedUser ?? report.reporter;

          return {
            id: report.id,
            reason: report.reason,
            status: report.status,
            targetType: report.targetType,
            snippet: report.targetSnippet || report.reasonDetail || "",
            createdAt: report.createdAt,
            reporter: reporterName,
            reportedUser: reportedName,
            avatar: avatarUser.profile?.avatarUrl ?? null,
            initials: personInitials(
              avatarUser.profile,
              reportedName || reporterName,
            ),
          };
        }),
        ads: recentAds.map((ad) => {
          const supplierName =
            personName(ad.supplier.profile) ||
            ad.supplier.profile?.company ||
            ad.supplier.email;
          const supplierCompany = ad.supplier.profile?.company || "";

          return {
            id: ad.id,
            title: ad.title,
            category: ad.category,
            createdAt: ad.createdAt,
            supplier: supplierName,
            supplierName,
            supplierCompany,
            supplierAvatar: ad.supplier.profile?.avatarUrl ?? null,
            supplierInitials: personInitials(
              ad.supplier.profile,
              supplierName,
            ),
          };
        }),
      },
      snapshot: {
        newSubscribers,
        newJobs,
        totalListings,
        pendingReports,
        pendingAds,
      },
    };
  },
};
