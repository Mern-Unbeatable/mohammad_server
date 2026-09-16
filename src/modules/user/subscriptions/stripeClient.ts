import Stripe from "stripe";
import { env } from "@/config/env";
import { BadRequestError } from "@/shared/errors/AppError";

let stripeClient: Stripe | null = null;

export function isPaymentConfigured(): boolean {
  return Boolean(
    env.stripe.secretKey &&
      env.stripe.priceMonthly &&
      env.stripe.priceYearly,
  );
}

export function getStripe(): Stripe {
  if (!env.stripe.secretKey) {
    throw new BadRequestError(
      "Stripe is not configured. Set STRIPE_SECRET_KEY and price IDs.",
    );
  }
  if (!stripeClient) {
    stripeClient = new Stripe(env.stripe.secretKey);
  }
  return stripeClient;
}

export function getStripePriceId(plan: "MONTHLY" | "YEARLY"): string {
  const priceId =
    plan === "YEARLY" ? env.stripe.priceYearly : env.stripe.priceMonthly;
  if (!priceId) {
    throw new BadRequestError(
      `Stripe price ID missing for ${plan}. Set STRIPE_PRICE_${plan}.`,
    );
  }
  return priceId;
}

export function planFromStripePriceId(
  priceId: string | null | undefined,
): "MONTHLY" | "YEARLY" | null {
  if (!priceId) return null;
  if (priceId === env.stripe.priceYearly) return "YEARLY";
  if (priceId === env.stripe.priceMonthly) return "MONTHLY";
  return null;
}
