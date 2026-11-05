import "server-only";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { assertCan } from "@/lib/permissions";
import type { TenantContext } from "@/lib/tenant-context";
import * as bookingRepo from "@/repositories/booking.repo";

// Dashboard-side bookings. (The customer-facing create flow is public-booking.service.)
// Services take the already-verified TenantContext and re-assert their own permission.
type Ctx = Pick<TenantContext, "tenantId" | "role">;

export async function listBookings(ctx: Ctx) {
  assertCan(ctx, "bookings:read");
  return bookingRepo.list(ctx.tenantId);
}

/** Upcoming (soonest first) or past (most recent first). */
export async function listBookingsByView(ctx: Ctx, view: "upcoming" | "past", now: Date = new Date()) {
  assertCan(ctx, "bookings:read");
  return bookingRepo.listByView(ctx.tenantId, view, now);
}

export async function getBooking(ctx: Ctx, bookingId: string) {
  assertCan(ctx, "bookings:read");
  const booking = await bookingRepo.findById(ctx.tenantId, bookingId);
  if (!booking) throw new NotFoundError("Booking");
  return booking;
}

export type ManualStatus = "CANCELLED" | "COMPLETED" | "NO_SHOW";

/**
 * Cancel, or mark completed / no-show. Allowed moves:
 *   CONFIRMED | PENDING_PAYMENT -> CANCELLED       (frees the slot: the exclusion constraint only
 *                                                   counts PENDING_PAYMENT and CONFIRMED)
 *   CONFIRMED                    -> COMPLETED / NO_SHOW, and only once the booking has started
 * Everything else is final. The status check is part of the UPDATE, so two people clicking at once
 * cannot both succeed.
 */
export async function setBookingStatus(ctx: Ctx, bookingId: string, to: ManualStatus, now: Date = new Date()) {
  assertCan(ctx, "bookings:write");
  const booking = await bookingRepo.findById(ctx.tenantId, bookingId);
  if (!booking) throw new NotFoundError("Booking");

  if (to !== "CANCELLED" && booking.startsAt > now) {
    throw new ConflictError("A booking can only be marked completed or no-show after it has started.", "NOT_STARTED");
  }
  const from = to === "CANCELLED" ? (["CONFIRMED", "PENDING_PAYMENT"] as const) : (["CONFIRMED"] as const);
  const moved = await bookingRepo.transitionStatus(ctx.tenantId, bookingId, [...from], to, now);
  if (!moved) {
    throw new ConflictError(`This booking is ${booking.status.replace("_", " ").toLowerCase()} and can't be changed that way.`, "INVALID_TRANSITION");
  }
  return bookingRepo.findById(ctx.tenantId, bookingId);
}
