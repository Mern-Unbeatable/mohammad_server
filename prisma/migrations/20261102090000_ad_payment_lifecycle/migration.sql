-- Advertisement payment + lifecycle support
-- Enum additions (applied out-of-transaction; Postgres requires new enum values committed before use)
ALTER TYPE "AdStatus" ADD VALUE IF NOT EXISTS 'PENDING_PAYMENT' BEFORE 'PENDING';
ALTER TYPE "AdStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AdPaymentStatus') THEN
    CREATE TYPE "AdPaymentStatus" AS ENUM ('UNPAID','PAID','REFUNDED');
  END IF;
END $$;

ALTER TABLE "Advertisement" ADD COLUMN IF NOT EXISTS "feeAmount" INTEGER;
ALTER TABLE "Advertisement" ADD COLUMN IF NOT EXISTS "paymentStatus" "AdPaymentStatus" NOT NULL DEFAULT 'UNPAID';
ALTER TABLE "Advertisement" ADD COLUMN IF NOT EXISTS "paidAt" TIMESTAMP(3);
ALTER TABLE "Advertisement" ADD COLUMN IF NOT EXISTS "stripeCheckoutSessionId" TEXT;
ALTER TABLE "Advertisement" ADD COLUMN IF NOT EXISTS "checkoutSessionExpiresAt" TIMESTAMP(3);
ALTER TABLE "Advertisement" ALTER COLUMN "status" SET DEFAULT 'PENDING_PAYMENT';
CREATE INDEX IF NOT EXISTS "Advertisement_stripeCheckoutSessionId_idx" ON "Advertisement"("stripeCheckoutSessionId");