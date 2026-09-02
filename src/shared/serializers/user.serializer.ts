import { Prisma, Profile, Subscription, User } from "@prisma/client";

type UserWithRelations = User & {
  profile?: Profile | null;
  subscription?: Subscription | null;
};

/** Public-safe user representation. Never leaks passwordHash. */
export const serializeUser = (user: UserWithRelations) => ({
  id: user.id,
  email: user.email,
  role: user.role,
  profileType: user.profileType,
  status: user.status,
  warnings: user.warnings,
  lastLoginAt: user.lastLoginAt,
  createdAt: user.createdAt,
  profile: user.profile ? serializeProfile(user.profile) : null,
  subscription: user.subscription
    ? serializeSubscription(user.subscription)
    : null,
});

export const serializeProfile = (profile: Profile) => ({
  firstName: profile.firstName,
  lastName: profile.lastName,
  name: `${profile.firstName} ${profile.lastName}`.trim(),
  title: profile.title,
  company: profile.company,
  country: profile.country,
  location: profile.location,
  phone: profile.phone,
  about: profile.about,
  aboutExtended: profile.aboutExtended,
  avatar: profile.avatarUrl,
  coverPhoto: profile.coverUrl,
  initials: profile.initials,
  connections: profile.connectionsCount,
});

export const serializeSubscription = (subscription: Subscription) => ({
  plan: subscription.plan,
  status: subscription.status,
  amount: subscription.amount / 100,
  billingCycle: subscription.billingCycle,
  startDate: subscription.startDate,
  renewalDate: subscription.renewalDate,
  nextPayment: subscription.nextPayment,
  paymentMethod: subscription.paymentMethod,
  trialDaysLeft: subscription.trialDaysLeft,
  trialDaysTotal: subscription.trialDaysTotal,
});

export const userWithRelations = {
  profile: true,
  subscription: true,
} satisfies Prisma.UserInclude;
