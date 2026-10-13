import { handle } from "@/lib/http";
import * as bookingService from "@/services/booking.service";
import { requireApiTenantContext } from "@/services/session.service";

export async function GET() {
  return handle(async () => {
    const ctx = await requireApiTenantContext("bookings:read");
    return Response.json(await bookingService.listBookings(ctx));
  });
}
