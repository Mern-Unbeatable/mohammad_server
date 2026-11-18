import { afterEach, describe, expect, it, vi } from "vitest";

/** Load stripeClient with a given STRIPE_AUTOMATIC_TAX value (env is read at import). */
async function loadWithFlag(value: string | undefined) {
  vi.resetModules();
  if (value === undefined) delete process.env.STRIPE_AUTOMATIC_TAX;
  else process.env.STRIPE_AUTOMATIC_TAX = value;
  return import("@/modules/user/subscriptions/stripeClient");
}

afterEach(() => {
  delete process.env.STRIPE_AUTOMATIC_TAX;
});

// The first dynamic import loads the module graph cold, which can be slow.
describe("checkoutTaxOptions", { timeout: 30_000 }, () => {
  it("adds nothing unless Stripe Tax is switched on", async () => {
    expect((await loadWithFlag(undefined)).checkoutTaxOptions(true)).toEqual({});
    expect((await loadWithFlag("false")).checkoutTaxOptions(true)).toEqual({});
  });

  it("turns on VAT, billing address and VAT-number collection", async () => {
    const { checkoutTaxOptions } = await loadWithFlag("true");
    expect(checkoutTaxOptions(true)).toEqual({
      automatic_tax: { enabled: true },
      billing_address_collection: "required",
      tax_id_collection: { enabled: true },
      customer_update: { address: "auto", name: "auto" },
    });
  });

  it("only asks to update an existing Stripe customer", async () => {
    const { checkoutTaxOptions } = await loadWithFlag("TRUE");
    const options = checkoutTaxOptions(false);
    expect(options.automatic_tax).toEqual({ enabled: true });
    expect(options).not.toHaveProperty("customer_update");
  });
});
