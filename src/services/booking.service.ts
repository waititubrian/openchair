import "server-only";
import { assertCan } from "@/lib/permissions";
import type { TenantContext } from "@/lib/tenant-context";
import { NotFoundError } from "@/lib/errors";
import * as bookingRepo from "@/repositories/booking.repo";

// Services take the already-verified TenantContext and re-assert their own permission, so
// they are safe no matter which caller (page, action, route, test) invokes them.
type Ctx = Pick<TenantContext, "tenantId" | "role">;

export async function listBookings(ctx: Ctx) {
  assertCan(ctx, "bookings:read");
  return bookingRepo.list(ctx.tenantId);
}

export async function getBooking(ctx: Ctx, bookingId: string) {
  assertCan(ctx, "bookings:read");
  const booking = await bookingRepo.findById(ctx.tenantId, bookingId);
  if (!booking) throw new NotFoundError("Booking");
  return booking;
}
