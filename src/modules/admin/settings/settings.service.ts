import { Prisma } from "@prisma/client";
import { prisma } from "@/infrastructure/prisma";
import { NotFoundError } from "@/shared/errors/AppError";
import {
  DEFAULT_AD_DURATION_DAYS,
  PRICING_CURRENCY,
  PRICING_INPUT_SCHEMAS,
  PRICING_NORMALIZERS,
  SETTING_KEYS,
  normalizeSponsoredPricing,
} from "./settings.pricing";

const normalizeValue = (key: string, value: unknown) =>
  PRICING_NORMALIZERS[key] ? PRICING_NORMALIZERS[key](value) : value;

const readSettingValue = async (key: string) =>
  (await prisma.appSetting.findUnique({ where: { key } }))?.value ?? null;

/** Pricing settings are persisted with only the editable fields. */
const toStoredValue = async (
  key: string,
  input: unknown,
): Promise<Prisma.InputJsonValue> => {
  const schema = PRICING_INPUT_SCHEMAS[key];
  if (!schema) return input as Prisma.InputJsonValue;

  const parsed = schema.parse(input);
  if (key !== SETTING_KEYS.sponsoredPricing) return parsed;

  const updates = new Map(
    (parsed as { id: string; price: number }[]).map((tier) => [
      tier.id,
      tier.price,
    ]),
  );
  const current = normalizeSponsoredPricing(
    await readSettingValue(SETTING_KEYS.sponsoredPricing),
  );
  return current.map(({ id, label, price }) => ({
    id,
    label,
    price: updates.get(id) ?? price,
  }));
};

export const settingsService = {
  async getSettings() {
    const settings = await prisma.appSetting.findMany();
    const result = settings.reduce<Record<string, unknown>>((acc, setting) => {
      acc[setting.key] = normalizeValue(setting.key, setting.value);
      return acc;
    }, {});
    for (const key of Object.keys(PRICING_NORMALIZERS)) {
      if (!(key in result)) result[key] = normalizeValue(key, null);
    }
    return result;
  },

  async getSetting(key: string) {
    const value = await readSettingValue(key);
    if (value === null && !PRICING_NORMALIZERS[key]) {
      throw new NotFoundError("Setting not found");
    }
    return normalizeValue(key, value);
  },

  async upsertSetting(key: string, input: unknown) {
    const value = await toStoredValue(key, input);
    const setting = await prisma.appSetting.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
    return { key: setting.key, value: normalizeValue(key, setting.value) };
  },

  /** Supplier-readable sponsored ad pricing used by the Create Ad duration step. */
  async getSponsoredPricing() {
    return {
      currency: PRICING_CURRENCY,
      defaultDurationDays: DEFAULT_AD_DURATION_DAYS,
      tiers: normalizeSponsoredPricing(
        await readSettingValue(SETTING_KEYS.sponsoredPricing),
      ),
    };
  },
};
