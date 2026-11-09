-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "stripeRequirementsDue" TEXT[] DEFAULT ARRAY[]::TEXT[];


-- A deposit is either free or at least Stripe's minimum charge (USD 0.50); Checkout rejects less.
ALTER TABLE "Service" ADD CONSTRAINT service_deposit_min CHECK ("depositCents" = 0 OR "depositCents" >= 50);
ALTER TABLE "Booking" ADD CONSTRAINT booking_deposit_min CHECK ("depositCents" = 0 OR "depositCents" >= 50);
