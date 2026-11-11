-- Payment history: one row per Stripe invoice (or invoiceless ad Checkout payment).
-- CreateEnum
CREATE TYPE "PaymentKind" AS ENUM ('SUBSCRIPTION', 'ADVERTISEMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PAID', 'OPEN', 'FAILED', 'VOID', 'UNCOLLECTIBLE');

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "PaymentKind" NOT NULL,
    "status" "PaymentStatus" NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'eur',
    "description" TEXT,
    "invoiceNumber" TEXT,
    "stripeInvoiceId" TEXT,
    "stripeCheckoutSessionId" TEXT,
    "stripeCustomerId" TEXT,
    "hostedInvoiceUrl" TEXT,
    "invoicePdfUrl" TEXT,
    "receiptUrl" TEXT,
    "advertisementId" TEXT,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Payment_stripeInvoiceId_key" ON "Payment"("stripeInvoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_stripeCheckoutSessionId_key" ON "Payment"("stripeCheckoutSessionId");

-- CreateIndex
CREATE INDEX "Payment_userId_issuedAt_idx" ON "Payment"("userId", "issuedAt");

-- CreateIndex
CREATE INDEX "Payment_kind_idx" ON "Payment"("kind");

-- CreateIndex
CREATE INDEX "Payment_status_idx" ON "Payment"("status");

-- CreateIndex
CREATE INDEX "Payment_issuedAt_idx" ON "Payment"("issuedAt");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_advertisementId_fkey" FOREIGN KEY ("advertisementId") REFERENCES "Advertisement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

