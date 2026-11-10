import { SUBSCRIPTION } from "@/lib/constants/business";

// Pure subscription logic (no database), so every date rule is unit-testable.

const DAY_MS = 24 * 60 * 60 * 1000;

export type SubscriptionState =
  | { state: "free" }
  | { state: "active"; periodEnd: Date; daysLeft: number }
  /** Past the paid period but still inside the grace period: Pro keeps working. */
  | { state: "grace"; periodEnd: Date; graceEnds: Date; daysLeft: number }
  /** Grace is over: the daily job downgrades the shop to Free. */
  | { state: "expired"; periodEnd: Date };

export const graceEnd = (periodEnd: Date): Date => new Date(periodEnd.getTime() + SUBSCRIPTION.graceDays * DAY_MS);

/** Whole days remaining until `end` (rounded up, never negative): "3 days left", never "0.4 days". */
export const daysUntil = (end: Date, now: Date): number => Math.max(0, Math.ceil((end.getTime() - now.getTime()) / DAY_MS));

/** What a subscription row means right now. `null` = the shop never paid. */
export function subscriptionState(sub: { currentPeriodEnd: Date } | null, now: Date): SubscriptionState {
  if (!sub) return { state: "free" };
  const periodEnd = sub.currentPeriodEnd;
  if (now < periodEnd) return { state: "active", periodEnd, daysLeft: daysUntil(periodEnd, now) };
  const graceEnds = graceEnd(periodEnd);
  if (now < graceEnds) return { state: "grace", periodEnd, graceEnds, daysLeft: daysUntil(graceEnds, now) };
  return { state: "expired", periodEnd };
}

/**
 * The end of the period a new payment buys. Renewing while still active (or in grace) extends from
 * the current end, so paying early loses nothing; a lapsed or first-time shop starts from `now`.
 */
export function nextPeriodEnd(existing: { currentPeriodEnd: Date } | null, now: Date): Date {
  const start = existing && existing.currentPeriodEnd > now ? existing.currentPeriodEnd : now;
  return new Date(start.getTime() + SUBSCRIPTION.periodDays * DAY_MS);
}

/** True while a shop should have Pro features. */
export const hasProAccess = (s: SubscriptionState): boolean => s.state === "active" || s.state === "grace";
