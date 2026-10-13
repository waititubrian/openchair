-- Database-level guarantees that Prisma's schema language cannot express.

-- btree_gist lets a GiST index/exclusion constraint combine plain equality (staffId)
-- with range overlap (&&) in one constraint.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- THE double-booking guard. Two bookings for the same staff member whose time ranges
-- overlap cannot both be "live" (PENDING_PAYMENT or CONFIRMED). Postgres checks this
-- atomically at insert time, so two concurrent requests cannot both succeed: the second
-- one fails with SQLSTATE 23P01 (exclusion_violation).
-- tstzrange is half-open [start, end), so back-to-back bookings (10:00-10:30, 10:30-11:00) are fine.
-- NOTE: a constraint can't call now(), so an *expired* hold is freed by the application
-- flipping its status to CANCELLED (cron sweep + a sweep inside the booking transaction).
ALTER TABLE "Booking"
  ADD CONSTRAINT booking_no_overlap
  EXCLUDE USING gist (
    "staffId" WITH =,
    tstzrange("startsAt", "endsAt") WITH &&
  )
  WHERE (status IN ('PENDING_PAYMENT', 'CONFIRMED'));

-- Sanity checks so bad data is rejected even if application code has a bug.
ALTER TABLE "Booking"      ADD CONSTRAINT booking_time_order   CHECK ("endsAt" > "startsAt");
ALTER TABLE "Booking"      ADD CONSTRAINT booking_money_nonneg CHECK ("priceCents" >= 0 AND "depositCents" >= 0 AND "depositCents" <= "priceCents");
ALTER TABLE "Service"      ADD CONSTRAINT service_duration_pos CHECK ("durationMin" > 0);
ALTER TABLE "Service"      ADD CONSTRAINT service_money_nonneg CHECK ("priceCents" >= 0 AND "depositCents" >= 0 AND "depositCents" <= "priceCents");
ALTER TABLE "TimeOff"      ADD CONSTRAINT timeoff_order        CHECK ("endsAt" > "startsAt");
ALTER TABLE "AvailabilityRule"
  ADD CONSTRAINT availability_valid CHECK (
    "dayOfWeek" BETWEEN 0 AND 6 AND "startMinute" >= 0 AND "endMinute" <= 1440 AND "endMinute" > "startMinute"
  );
ALTER TABLE "Payment"      ADD CONSTRAINT payment_money_nonneg CHECK ("amountCents" >= 0 AND "applicationFeeCents" >= 0 AND "applicationFeeCents" <= "amountCents");
