-- AlterEnum: add PAST_DUE to SubscriptionStatus (additive, safe)
ALTER TYPE "SubscriptionStatus" ADD VALUE IF NOT EXISTS 'PAST_DUE';

-- AlterTable: checkout reservation window prevents duplicate checkouts
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "checkoutSessionExpiresAt" TIMESTAMP(3);

-- CreateTable: Stripe webhook idempotency ledger
CREATE TABLE IF NOT EXISTS "StripeWebhookEvent" (
    "id" TEXT NOT NULL,
    "stripeEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "processingStatus" TEXT NOT NULL DEFAULT 'RECEIVED',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "stripeCreatedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "StripeWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "StripeWebhookEvent_stripeEventId_key" ON "StripeWebhookEvent"("stripeEventId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "StripeWebhookEvent_eventType_idx" ON "StripeWebhookEvent"("eventType");
