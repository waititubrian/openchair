import "server-only";
import { PLANS } from "@/lib/constants/business";
import { localInstant } from "@/lib/dates";
import { PlanLimitError } from "@/lib/errors";
import { formatInZone } from "@/lib/time";
import type { TenantContext } from "@/lib/tenant-context";
import * as bookingRepo from "@/repositories/booking.repo";
import * as staffRepo from "@/repositories/staff.repo";
import type { Tx } from "@/repositories/transaction";

// Plan limits are enforced here, server-side, never only in the UI. Limits come from
// src/lib/constants/business.ts.

type PlanTenant = Pick<TenantContext, "tenantId" | "tenant">;

/** Throws PlanLimitError when adding/reactivating one more ACTIVE staff member would exceed the plan. */
export async function assertCanAddActiveStaff(ctx: PlanTenant, tx?: Tx) {
  const plan = PLANS[ctx.tenant.plan];
  if (!Number.isFinite(plan.maxStaff)) return;
  const active = await staffRepo.countActive(ctx.tenantId, tx);
  if (active >= plan.maxStaff) {
    throw new PlanLimitError(
      `The ${plan.label} plan includes ${plan.maxStaff} staff member${plan.maxStaff === 1 ? "" : "s"}. Upgrade to Pro to add more.`,
    );
  }
}

/** The calendar month an instant falls in, IN THE SHOP'S TIMEZONE, as [from, to) instants plus a key. */
export function monthWindow(instant: Date, timeZone: string) {
  const first = `${formatInZone(instant, timeZone, "yyyy-MM")}-01`;
  const [y, m] = first.split("-").map(Number);
  const nextFirst = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return { key: first.slice(0, 7), from: localInstant(first, 0, timeZone), to: localInstant(nextFirst, 0, timeZone) };
}

/**
 * Enforce the monthly booking limit for the month the APPOINTMENT falls in. Must run inside the booking
 * transaction: it takes a per-shop, per-month database lock first, so two simultaneous requests cannot
 * both see 29 bookings and both succeed (ending at 31 on a 30 limit). The lock is released when the
 * transaction ends. Plans without a limit skip the lock entirely.
 */
export async function assertCanCreateBooking(tenant: PlanTenant["tenant"], startsAt: Date, now: Date, tx: Tx) {
  const limit = PLANS[tenant.plan].maxBookingsPerMonth;
  if (!Number.isFinite(limit)) return;
  const window = monthWindow(startsAt, tenant.timezone);
  await bookingRepo.lockTenantMonth(tenant.id, window.key, tx);
  const used = await bookingRepo.countInRange(tenant.id, window.from, window.to, now, tx);
  if (used >= limit) {
    // Worded for the CUSTOMER (this is the public booking flow): no plan details.
    throw new PlanLimitError("This shop isn't taking any more online bookings this month. Please contact them directly.");
  }
}

/** For the owner's dashboard: how much of this month's allowance is used. */
export async function getBookingUsage(ctx: PlanTenant, now: Date = new Date()) {
  const limit = PLANS[ctx.tenant.plan].maxBookingsPerMonth;
  const window = monthWindow(now, ctx.tenant.timezone);
  const used = await bookingRepo.countInRange(ctx.tenantId, window.from, window.to, now);
  return { used, limit: Number.isFinite(limit) ? limit : null, monthKey: window.key };
}

