-- Stripe -> M-Pesa, USD -> KES.
--
-- Existing Payment and Subscription rows are Stripe TEST data (Stripe session ids, no payer phone or
-- M-Pesa receipt) and cannot be converted, so they are cleared. Re-run `npm run db:seed` for demo data.
DELETE FROM "Payment";
DELETE FROM "Subscription";
-- Prices keep their numbers; only the currency label changes (shops should review their prices in KES).
UPDATE "Tenant" SET "currency" = 'kes';

-- AlterEnum
ALTER TYPE "PaymentStatus" ADD VALUE 'NEEDS_REFUND';

-- DropIndex
DROP INDEX "Payment_stripeCheckoutSessionId_key";

-- DropIndex
DROP INDEX "Payment_stripePaymentIntentId_key";

-- DropIndex
DROP INDEX "Subscription_stripeSubscriptionId_key";

-- DropIndex
DROP INDEX "Tenant_stripeAccountId_key";

-- DropIndex
DROP INDEX "Tenant_stripeCustomerId_key";

-- AlterTable
ALTER TABLE "Payment" DROP COLUMN "stripeCheckoutSessionId",
DROP COLUMN "stripePaymentIntentId",
ADD COLUMN     "checkoutRequestId" TEXT,
ADD COLUMN     "lastQueriedAt" TIMESTAMPTZ(3),
ADD COLUMN     "merchantRequestId" TEXT,
ADD COLUMN     "mpesaReceipt" TEXT,
ADD COLUMN     "phone" TEXT NOT NULL,
ADD COLUMN     "resultCode" INTEGER,
ADD COLUMN     "resultDesc" TEXT,
ALTER COLUMN "currency" SET DEFAULT 'kes';

-- AlterTable
ALTER TABLE "Subscription" DROP COLUMN "cancelAtPeriodEnd",
DROP COLUMN "status",
DROP COLUMN "stripeSubscriptionId",
ALTER COLUMN "currentPeriodEnd" SET NOT NULL;

-- AlterTable
ALTER TABLE "Tenant" DROP COLUMN "chargesEnabled",
DROP COLUMN "detailsSubmitted",
DROP COLUMN "payoutsEnabled",
DROP COLUMN "stripeAccountId",
DROP COLUMN "stripeCustomerId",
DROP COLUMN "stripeRequirementsDue",
ADD COLUMN     "payoutPhone" TEXT,
ALTER COLUMN "currency" SET DEFAULT 'kes';

-- CreateTable
CREATE TABLE "SubscriptionPayment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'kes',
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "merchantRequestId" TEXT,
    "checkoutRequestId" TEXT,
    "mpesaReceipt" TEXT,
    "resultCode" INTEGER,
    "resultDesc" TEXT,
    "failureReason" TEXT,
    "lastQueriedAt" TIMESTAMPTZ(3),
    "periodEnd" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SubscriptionPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payout" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "phone" TEXT NOT NULL,
    "reference" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionPayment_checkoutRequestId_key" ON "SubscriptionPayment"("checkoutRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionPayment_mpesaReceipt_key" ON "SubscriptionPayment"("mpesaReceipt");

-- CreateIndex
CREATE INDEX "SubscriptionPayment_tenantId_createdAt_idx" ON "SubscriptionPayment"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "SubscriptionPayment_status_createdAt_idx" ON "SubscriptionPayment"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Payout_tenantId_createdAt_idx" ON "Payout"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_checkoutRequestId_key" ON "Payment"("checkoutRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_mpesaReceipt_key" ON "Payment"("mpesaReceipt");

-- CreateIndex
CREATE INDEX "Payment_status_createdAt_idx" ON "Payment"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "SubscriptionPayment" ADD CONSTRAINT "SubscriptionPayment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Money is whole shillings (M-Pesa cannot collect fractions). NOT VALID: enforced for new and changed
-- rows without failing on legacy rows that predate the rule.
ALTER TABLE "Service" DROP CONSTRAINT IF EXISTS service_deposit_min;
ALTER TABLE "Booking" DROP CONSTRAINT IF EXISTS booking_deposit_min;
ALTER TABLE "Service" ADD CONSTRAINT service_whole_shillings CHECK ("priceCents" % 100 = 0 AND "depositCents" % 100 = 0) NOT VALID;
ALTER TABLE "Booking" ADD CONSTRAINT booking_whole_shillings CHECK ("priceCents" % 100 = 0 AND "depositCents" % 100 = 0) NOT VALID;
ALTER TABLE "Payment" ADD CONSTRAINT payment_whole_shillings CHECK ("amountCents" % 100 = 0) NOT VALID;
ALTER TABLE "SubscriptionPayment" ADD CONSTRAINT subpayment_amount_pos CHECK ("amountCents" > 0 AND "amountCents" % 100 = 0);
ALTER TABLE "Payout" ADD CONSTRAINT payout_amount_pos CHECK ("amountCents" > 0);
