import Stripe from "stripe";
import { env } from "@/config/env";
import { BadRequestError } from "@/shared/errors/AppError";

let stripeClient: Stripe | null = null;

export function isPaymentConfigured(): boolean {
  return Boolean(
    env.stripe.secretKey && env.stripe.priceMonthly && env.stripe.priceYearly,
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

type CheckoutTaxOptions = Pick<
  Stripe.Checkout.SessionCreateParams,
  | "automatic_tax"
  | "billing_address_collection"
  | "tax_id_collection"
  | "customer_update"
>;

/**
 * Checkout options for Stripe Tax (21% Belgian VAT on Lab Unity). When
 * STRIPE_AUTOMATIC_TAX=true, Checkout shows the VAT line, collects the
 * billing address it needs to pick the rate, and lets companies enter their
 * VAT number (shown on the invoice; EU reverse charge applies to valid
 * foreign VAT numbers). On by default; STRIPE_AUTOMATIC_TAX=false turns it
 * off for accounts without Stripe Tax. An existing Stripe customer must let Checkout save the address
 * and name it collects (`customer_update`).
 */
export function checkoutTaxOptions(hasCustomer: boolean): CheckoutTaxOptions {
  if (!env.stripe.automaticTax) return {};
  return {
    automatic_tax: { enabled: true },
    billing_address_collection: "required",
    tax_id_collection: { enabled: true },
    ...(hasCustomer
      ? { customer_update: { address: "auto", name: "auto" } }
      : {}),
  };
}

export function planFromStripePriceId(
  priceId: string | null | undefined,
): "MONTHLY" | "YEARLY" | null {
  if (!priceId) return null;
  if (priceId === env.stripe.priceYearly) return "YEARLY";
  if (priceId === env.stripe.priceMonthly) return "MONTHLY";
  return null;
}
