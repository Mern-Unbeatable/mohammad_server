import { Prisma, Profile, Subscription, User } from "@prisma/client";
import { deriveSubscriptionState } from "@/modules/user/subscriptions/subscriptionLifecycle";
import { resolveProfileLocation } from "@/shared/utils/location";

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
  ...resolveProfileLocation(profile.location, profile.country),
  phone: profile.phone,
  about: profile.about,
  aboutExtended: profile.aboutExtended,
  avatar: profile.avatarUrl,
  coverPhoto: profile.coverUrl,
  initials: profile.initials,
  connections: profile.connectionsCount,
});

export const serializeSubscription = (subscription: Subscription) => {
  const derived = deriveSubscriptionState(subscription);

  return {
    plan: subscription.plan,
    status: derived.status,
    amount: subscription.amount / 100,
    billingCycle: subscription.billingCycle,
    startDate: subscription.startDate,
    renewalDate: subscription.renewalDate,
    nextPayment: subscription.nextPayment,
    paymentMethod: subscription.paymentMethod,
    trialDaysLeft: derived.trialDaysLeft,
    trialDaysTotal: derived.trialDaysTotal,
    isActive: derived.isActive,
    accessEndsAt: derived.accessEndsAt,
    cancelAtPeriodEnd: derived.cancelAtPeriodEnd,
  };
};

export const userWithRelations = {
  profile: true,
  subscription: true,
} satisfies Prisma.UserInclude;
