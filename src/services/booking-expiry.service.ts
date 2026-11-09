import "server-only";
import { PUBLIC_BOOKING_RATE_LIMIT } from "@/lib/constants/business";
import { getStripe, isStripeConfigured } from "@/lib/stripe";
import * as bookingRepo from "@/repositories/booking.repo";
import * as paymentRepo from "@/repositories/payment.repo";
import * as rateLimitRepo from "@/repositories/rate-limit.repo";

/**
 * Scheduled housekeeping (Vercel Cron -> /api/cron/expire-holds). Correctness does NOT depend on
 * how often this runs: slot queries already ignore expired holds, and booking creation frees any
 * stale hold it overlaps. This just tidies the database and closes Stripe Checkout Sessions so a
 * customer can't start paying for a slot we have already released.
 */
export async function sweepExpiredHolds(now: Date = new Date()) {
  const cancelled = await bookingRepo.expireAllStaleHolds(now);

  let sessionsExpired = 0;
  if (cancelled.length > 0 && isStripeConfigured()) {
    const open = await paymentRepo.listPendingForBookings(cancelled.map((b) => b.id));
    const stripe = getStripe();
    for (const p of open) {
      if (!p.tenant.stripeAccountId) continue;
      try {
        await stripe.checkout.sessions.expire(p.stripeCheckoutSessionId, undefined, { stripeAccount: p.tenant.stripeAccountId });
        sessionsExpired++;
      } catch {
        // already expired or completed: nothing to do (a completed one is handled by its webhook)
      }
    }
  }

  const purged = await rateLimitRepo.purgeExpired(PUBLIC_BOOKING_RATE_LIMIT.windowSeconds, now);
  return { holdsCancelled: cancelled.length, sessionsExpired, rateLimitRowsPurged: purged };
}
