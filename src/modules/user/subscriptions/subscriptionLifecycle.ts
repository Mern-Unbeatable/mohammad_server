import { Subscription, SubscriptionPlan, SubscriptionStatus } from "@prisma/client";

export const DEFAULT_TRIAL_DAYS = 90;

const MS_PER_DAY = 86_400_000;

export type DerivedSubscriptionState = {
  status: SubscriptionStatus;
  trialDaysLeft: number;
  trialDaysTotal: number;
  isActive: boolean;
  accessEndsAt: Date | null;
  cancelAtPeriodEnd: boolean;
};

function trialEndDate(subscription: Subscription): Date {
  const total = subscription.trialDaysTotal || DEFAULT_TRIAL_DAYS;
  const start = subscription.startDate ?? subscription.createdAt;
  const end = new Date(start);
  end.setDate(end.getDate() + total);
  return end;
}

export function computeTrialDaysLeft(subscription: Subscription): number {
  if (subscription.status !== SubscriptionStatus.TRIAL) return 0;
  const end = trialEndDate(subscription);
  return Math.max(0, Math.ceil((end.getTime() - Date.now()) / MS_PER_DAY));
}

/**
 * Resolve effective subscription status + access flags from stored row.
 * Pure — does not write to the database.
 */
export function deriveSubscriptionState(
  subscription: Subscription,
  now = new Date(),
): DerivedSubscriptionState {
  const trialDaysTotal = subscription.trialDaysTotal || DEFAULT_TRIAL_DAYS;
  const trialDaysLeft = computeTrialDaysLeft(subscription);
  const renewal = subscription.renewalDate
    ? new Date(subscription.renewalDate)
    : null;
  const renewalPassed = Boolean(renewal && renewal.getTime() <= now.getTime());

  if (subscription.status === SubscriptionStatus.TRIAL) {
    if (trialDaysLeft <= 0) {
      return {
        status: SubscriptionStatus.EXPIRED,
        trialDaysLeft: 0,
        trialDaysTotal,
        isActive: false,
        accessEndsAt: trialEndDate(subscription),
        cancelAtPeriodEnd: false,
      };
    }
    return {
      status: SubscriptionStatus.TRIAL,
      trialDaysLeft,
      trialDaysTotal,
      isActive: true,
      accessEndsAt: trialEndDate(subscription),
      cancelAtPeriodEnd: false,
    };
  }

  if (subscription.status === SubscriptionStatus.ACTIVE) {
    // Stripe-managed subscriptions are renewed/expired by webhooks.
    // Only local (non-Stripe) ACTIVE rows expire when the period ends.
    const stripeManaged = Boolean(
      (subscription as { stripeSubscriptionId?: string | null })
        .stripeSubscriptionId,
    );
    if (!stripeManaged && renewalPassed) {
      return {
        status: SubscriptionStatus.EXPIRED,
        trialDaysLeft: 0,
        trialDaysTotal,
        isActive: false,
        accessEndsAt: renewal,
        cancelAtPeriodEnd: false,
      };
    }
    return {
      status: SubscriptionStatus.ACTIVE,
      trialDaysLeft: 0,
      trialDaysTotal,
      isActive: true,
      accessEndsAt: renewal,
      cancelAtPeriodEnd: false,
    };
  }

  if (subscription.status === SubscriptionStatus.PAST_DUE) {
    // Renewal payment is overdue/unpaid. Premium access is restricted until
    // the provider confirms the subscription is paid/active again.
    return {
      status: SubscriptionStatus.PAST_DUE,
      trialDaysLeft: 0,
      trialDaysTotal,
      isActive: false,
      accessEndsAt: renewal,
      cancelAtPeriodEnd: false,
    };
  }

  if (subscription.status === SubscriptionStatus.CANCELLED) {
    // Access continues until the prepaid period ends.
    if (renewal && !renewalPassed) {
      return {
        status: SubscriptionStatus.CANCELLED,
        trialDaysLeft: 0,
        trialDaysTotal,
        isActive: true,
        accessEndsAt: renewal,
        cancelAtPeriodEnd: true,
      };
    }
    return {
      status: SubscriptionStatus.EXPIRED,
      trialDaysLeft: 0,
      trialDaysTotal,
      isActive: false,
      accessEndsAt: renewal,
      cancelAtPeriodEnd: false,
    };
  }

  // EXPIRED or unknown
  return {
    status: SubscriptionStatus.EXPIRED,
    trialDaysLeft: 0,
    trialDaysTotal,
    isActive: false,
    accessEndsAt: renewal ?? subscription.startDate ?? null,
    cancelAtPeriodEnd: false,
  };
}

export function addBillingPeriod(from: Date, plan: SubscriptionPlan): Date {
  const renewal = new Date(from);
  if (plan === SubscriptionPlan.YEARLY) {
    renewal.setFullYear(renewal.getFullYear() + 1);
  } else {
    renewal.setMonth(renewal.getMonth() + 1);
  }
  return renewal;
}
