import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/dashboard/empty-state";
import { formatInZone } from "@/lib/time";
import * as bookingService from "@/services/booking.service";
import { requireTenantContext } from "@/services/session.service";

export const metadata: Metadata = { title: "Bookings" };

export default async function BookingsPage() {
  const ctx = await requireTenantContext("bookings:read");
  const bookings = await bookingService.listBookings(ctx);
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Bookings</h1>
      {bookings.length === 0 ? (
        <EmptyState title="No bookings yet" description="Share your booking link and they'll appear here." />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="p-3 font-medium">When ({ctx.tenant.timezone})</th>
                <th className="p-3 font-medium">Customer</th>
                <th className="p-3 font-medium">Service</th>
                <th className="p-3 font-medium">With</th>
                <th className="p-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {bookings.map((b) => (
                <tr key={b.id} className="border-t">
                  <td className="p-3">
                    <Link href={`/dashboard/bookings/${b.id}`} className="underline underline-offset-4">
                      {formatInZone(b.startsAt, ctx.tenant.timezone)}
                    </Link>
                  </td>
                  <td className="p-3">{b.customer.name}</td>
                  <td className="p-3">{b.service.name}</td>
                  <td className="p-3">{b.staff.name}</td>
                  <td className="p-3">{b.status.replace("_", " ").toLowerCase()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
