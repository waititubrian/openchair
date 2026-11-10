import "server-only";
import { PUBLIC_BOOKING_RATE_LIMIT } from "@/lib/constants/business";
import { isMpesaConfigured } from "@/lib/mpesa";
import * as bookingRepo from "@/repositories/booking.repo";
import * as rateLimitRepo from "@/repositories/rate-limit.repo";
import { downgradeLapsedShops } from "./billing.service";
import { sweepStalePrompts } from "./mpesa-settlement.service";

/**
 * Scheduled housekeeping (Vercel Cron -> /api/cron/expire-holds, daily on the free plan). Correctness does
 * NOT depend on how often this runs: slot queries already ignore expired holds, booking creation frees any
 * stale hold it overlaps, and the confirmation/billing pages settle their own prompts while open. This just
 * tidies the database:
 *   - settles or expires M-Pesa prompts nobody finished (a late approval is still honoured),
 *   - cancels expired booking holds across all shops,
 *   - drops shops whose Pro period and grace period have both ended back to Free,
 *   - purges old throttle counters.
 */
export async function sweepExpiredHolds(now: Date = new Date()) {
  // Prompts first: a payment that was approved just before its hold lapsed should confirm the booking.
  const promptsSettled = isMpesaConfigured() ? await sweepStalePrompts(now) : 0;
  const cancelled = await bookingRepo.expireAllStaleHolds(now);
  const shopsDowngraded = await downgradeLapsedShops(now);
  const purged = await rateLimitRepo.purgeExpired(PUBLIC_BOOKING_RATE_LIMIT.windowSeconds, now);
  return { holdsCancelled: cancelled.length, promptsSettled, shopsDowngraded, rateLimitRowsPurged: purged };
}
