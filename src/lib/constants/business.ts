/**
 * Every tunable business number lives here, so changing pricing or limits is a
 * one-file edit. Nothing else in the codebase should hard-code these values.
 * (All figures are demo values.)
 */
import type { Plan } from "@/lib/domain";

export const PLATFORM_FEE_PERCENT = 5; // taken from each customer deposit (Stripe application fee)

export const PLANS = {
  FREE: {
    label: "Free",
    priceCentsPerMonth: 0,
    maxStaff: 1,
    maxBookingsPerMonth: 30,
  },
  PRO: {
    label: "Pro",
    priceCentsPerMonth: 1900,
    maxStaff: Number.POSITIVE_INFINITY,
    maxBookingsPerMonth: Number.POSITIVE_INFINITY,
  },
} as const satisfies Record<
  Plan,
  {
    label: string;
    priceCentsPerMonth: number;
    maxStaff: number;
    maxBookingsPerMonth: number;
  }
>;

export const BOOKING = {
  /** Default minutes a PENDING_PAYMENT booking holds its slot (tenant can override). */
  defaultHoldMinutes: 15,
  /** Granularity of offered start times. */
  slotIntervalMinutes: 15,
  /** Customers can't book closer to "now" than this. */
  minNoticeMinutes: 60,
  /** How far ahead the public page lets customers book. */
  maxAdvanceDays: 60,
  /** One customer (email) can hold at most this many upcoming live bookings in one shop. */
  maxActiveBookingsPerCustomer: 5,
  /** Days shown per page on the public time picker. */
  daysPerPage: 7,
} as const;

/** Stripe cannot charge less than this (USD). A deposit is either 0 or at least this much. */
export const MIN_DEPOSIT_CENTS = 50;

/** Country new Express connected accounts are created in (the shop confirms it during onboarding). */
export const CONNECT_COUNTRY = "US";

/**
 * Stripe won't let a Checkout Session live less than 30 minutes, which is longer than the booking
 * hold. We use 31 to stay clear of the boundary. A payment that lands after the hold has lapsed is
 * handled by the webhook (revive the booking if the slot is free, otherwise refund).
 */
export const CHECKOUT_SESSION_MINUTES = 31;

/** Throttle on the PUBLIC booking form (no login to rate-limit by), per client IP and shop. */
export const PUBLIC_BOOKING_RATE_LIMIT = { windowSeconds: 600, max: 10 } as const;

/** Platform fee on a deposit, in cents, rounded down. */
export function platformFeeCents(depositCents: number): number {
  return Math.floor((depositCents * PLATFORM_FEE_PERCENT) / 100);
}
