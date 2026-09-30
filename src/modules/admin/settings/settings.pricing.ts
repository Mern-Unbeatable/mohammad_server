import { z } from "zod";
import { PLAN_CATALOGUE } from "@/modules/user/subscriptions/planCatalogue";

/**
 * Single source of truth for sponsored-ad and subscription pricing.
 * Saved `AppSetting` values only override prices; tier ids, days, labels and
 * defaults live here so every consumer (admin, supplier) sees the same shape.
 */

export const SETTING_KEYS = {
  subscriptionPricing: "subscription_pricing",
  sponsoredPricing: "sponsored_pricing",
} as const;

export const PRICING_CURRENCY = "EUR";

export const SPONSORED_TIERS = [
  { id: "7-days", days: 7, label: "7 Days", defaultPrice: 35, popular: false },
  { id: "14-days", days: 14, label: "14 Days", defaultPrice: 60, popular: true },
  { id: "30-days", days: 30, label: "30 Days", defaultPrice: 100, popular: false },
] as const;

export type SponsoredTierId = (typeof SPONSORED_TIERS)[number]["id"];

export const DEFAULT_AD_DURATION_DAYS = 7;

export const isSponsoredDuration = (days: number) =>
  SPONSORED_TIERS.some((tier) => tier.days === days);

const TIER_IDS = SPONSORED_TIERS.map((tier) => tier.id) as [
  SponsoredTierId,
  ...SponsoredTierId[],
];

const MAX_PRICE = 1_000_000;

const roundPrice = (value: number) => Math.round(value * 100) / 100;

const toPrice = (value: unknown, fallback: number) => {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value.trim())
        : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= MAX_PRICE
    ? roundPrice(parsed)
    : fallback;
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const catalogueDefault = (id: "monthly" | "yearly") =>
  (PLAN_CATALOGUE.find((plan) => plan.id === id)?.price ?? 0) / 100;

export const normalizeSponsoredPricing = (value: unknown) => {
  const saved = Array.isArray(value) ? value.map(asRecord) : [];
  return SPONSORED_TIERS.map((tier) => ({
    id: tier.id,
    days: tier.days,
    label: tier.label,
    price: toPrice(
      saved.find((item) => item.id === tier.id)?.price,
      tier.defaultPrice,
    ),
    popular: tier.popular,
  }));
};

export const normalizeSubscriptionPricing = (value: unknown) => {
  const saved = asRecord(value);
  return {
    monthly: toPrice(saved.monthly, catalogueDefault("monthly")),
    yearly: toPrice(saved.yearly, catalogueDefault("yearly")),
  };
};

export const PRICING_NORMALIZERS: Record<string, (value: unknown) => unknown> = {
  [SETTING_KEYS.sponsoredPricing]: normalizeSponsoredPricing,
  [SETTING_KEYS.subscriptionPricing]: normalizeSubscriptionPricing,
};

const priceSchema = z
  .union([z.number(), z.string().trim().min(1).transform(Number)])
  .pipe(z.number().finite().nonnegative().max(MAX_PRICE))
  .transform(roundPrice);

export const PRICING_INPUT_SCHEMAS: Record<string, z.ZodTypeAny> = {
  [SETTING_KEYS.sponsoredPricing]: z
    .array(z.object({ id: z.enum(TIER_IDS), price: priceSchema }))
    .min(1),
  [SETTING_KEYS.subscriptionPricing]: z.object({
    monthly: priceSchema,
    yearly: priceSchema,
  }),
};
