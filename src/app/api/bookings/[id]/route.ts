import { handle } from "@/lib/http";
import * as bookingService from "@/services/booking.service";
import { requireApiTenantContext } from "@/services/session.service";

export async function GET(_req: Request, route: RouteContext<"/api/bookings/[id]">) {
  return handle(async () => {
    const { id } = await route.params;
    const ctx = await requireApiTenantContext("bookings:read");
    return Response.json(await bookingService.getBooking(ctx, id));
  });
}
