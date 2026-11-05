"use server";

import { refresh } from "next/cache";
import { toActionError, type ActionResult } from "@/lib/action-result";
import * as bookingService from "@/services/booking.service";
import { requireTenantContext } from "@/services/session.service";
import { bookingStatusInput } from "@/validators/booking";

/** Cancel / mark completed / mark no-show. The service enforces which moves are legal. */
export async function setBookingStatusAction(bookingId: string, status: string): Promise<ActionResult> {
  const ctx = await requireTenantContext("bookings:write");
  try {
    await bookingService.setBookingStatus(ctx, bookingId, bookingStatusInput.parse({ status }).status);
  } catch (e) {
    return toActionError(e);
  }
  refresh();
  return { ok: true };
}
