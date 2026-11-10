/**
 * Every tunable business number lives here, so changing pricing or limits is a
 * one-file edit. Nothing else in the codebase should hard-code these values.
 * (All figures are demo values.)
 *
 * Money is stored as integer CENTS of KES (100 cents = KES 1) but is always a WHOLE number of
 * shillings, because M-Pesa cannot collect fractions. So KES 2,500 is 250_000 here.
 */
import type { Plan } from "@/lib/domain";

/** The only currency the app uses. (Stored per shop as lowercase text.) */
export const CURRENCY = "kes";

export const PLATFORM_FEE_PERCENT = 5; // kept by the platform from each customer deposit

export const PLANS = {
  FREE: {
    label: "Free",
    priceCentsPerMonth: 0,
    maxStaff: 1,
    maxBookingsPerMonth: 30,
  },
  PRO: {
    label: "Pro",
    priceCentsPerMonth: 250_000, // KES 2,500 per 30 days
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

/**
 * Pro is PREPAID (M-Pesa can't auto-debit): one payment buys one period. Renewing extends from the
 * current end date, so paying early loses nothing. After the end there is a grace period during which
 * Pro keeps working, then the daily job drops the shop to Free.
 */
export const SUBSCRIPTION = { periodDays: 30, graceDays: 3 } as const;

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

/** M-Pesa Express (STK Push) rules. */
export const MPESA = {
  /** Safaricom's per-transaction ceiling for STK Push (KES 150,000). */
  maxAmountCents: 15_000_000,
  /** Don't send a second prompt to the same booking sooner than this (the first may still be on the phone). */
  minSecondsBetweenPrompts: 45,
  /** A booking can have at most this many deposit prompts (stops prompt-spamming a phone number). */
  maxPromptsPerBooking: 5,
  /** A prompt nobody answered for this long is treated as expired. */
  promptExpiresAfterMinutes: 10,
} as const;

/** Throttle on the PUBLIC booking form (no login to rate-limit by), per client IP and shop. */
export const PUBLIC_BOOKING_RATE_LIMIT = { windowSeconds: 600, max: 10 } as const;

/** Platform fee on a deposit, in cents, rounded down. */
export function platformFeeCents(depositCents: number): number {
  return Math.floor((depositCents * PLATFORM_FEE_PERCENT) / 100);
}
