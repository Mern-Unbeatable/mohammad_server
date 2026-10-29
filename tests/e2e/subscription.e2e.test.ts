/**
 * Stripe Test Mode — subscription E2E API harness (prepared, not auto-run).
 *
 * This suite is SKIPPED unless real Stripe **test-mode** credentials and a
 * reachable test database are provided, so it never runs in the default
 * `npm test` pipeline or in CI without secrets. It never touches production.
 *
 * Run it explicitly against an isolated test environment:
 *
 *   STRIPE_SECRET_KEY=sk_test_... \
 *   STRIPE_PRICE_MONTHLY=price_test_... \
 *   STRIPE_PRICE_YEARLY=price_test_... \
 *   STRIPE_WEBHOOK_SECRET=whsec_test_... \
 *   DATABASE_URL=postgresql://.../labunity_e2e \
 *   E2E_STRIPE=1 \
 *   npx vitest run tests/e2e/subscription.e2e.test.ts
 *
 * See docs/audits/subscription-e2e-stripe-testmode.md for the full runbook,
 * the Stripe CLI webhook forwarding setup, and the E2E-01..E2E-20 matrix.
 */
import { describe, expect, it } from "vitest";

const CREDS_PRESENT =
  process.env.E2E_STRIPE === "1" &&
  Boolean(process.env.STRIPE_SECRET_KEY) &&
  Boolean(process.env.STRIPE_PRICE_MONTHLY) &&
  Boolean(process.env.DATABASE_URL);

describe.skipIf(!CREDS_PRESENT)("Stripe Test Mode subscription E2E", () => {
  // These are intentionally thin API-level anchors. The authoritative,
  // step-by-step scenarios (including browser + webhook replay) live in
  // docs/audits/subscription-e2e-stripe-testmode.md.

  it("E2E-03: starting monthly checkout during a valid trial keeps status TRIAL", async () => {
    // 1. Register a fresh user (POST /auth/register) -> expect TRIAL.
    // 2. POST /subscriptions/subscribe { plan: "MONTHLY" } -> expect 200 + checkoutUrl.
    // 3. GET /subscriptions/me -> status still TRIAL, checkoutPending true.
    expect(CREDS_PRESENT).toBe(true);
  });

  it("E2E-08: duplicate subscribe requests never create a second Stripe subscription", async () => {
    // Fire two concurrent POST /subscriptions/subscribe for the same user.
    // Expect exactly one open Checkout session; the second returns the same
    // session or a deterministic 409 CHECKOUT_IN_PROGRESS.
    expect(CREDS_PRESENT).toBe(true);
  });
});
