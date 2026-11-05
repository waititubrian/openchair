import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/dashboard/empty-state";
import { formatInZone } from "@/lib/time";
import { cn } from "@/lib/utils";
import * as bookingService from "@/services/booking.service";
import { requireTenantContext } from "@/services/session.service";

export const metadata: Metadata = { title: "Bookings" };

const STATUS_STYLE: Record<string, string> = {
  CONFIRMED: "text-green-700 dark:text-green-400",
  PENDING_PAYMENT: "text-amber-700 dark:text-amber-400",
  CANCELLED: "text-muted-foreground line-through",
  COMPLETED: "text-muted-foreground",
  NO_SHOW: "text-red-700 dark:text-red-400",
};

export default async function BookingsPage({ searchParams }: PageProps<"/dashboard/bookings">) {
  const ctx = await requireTenantContext("bookings:read");
  const { view: rawView } = await searchParams;
  const view = (Array.isArray(rawView) ? rawView[0] : rawView) === "past" ? "past" : "upcoming";
  const bookings = await bookingService.listBookingsByView(ctx, view);
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Bookings</h1>
      <nav aria-label="Bookings view" className="flex gap-2">
        {(["upcoming", "past"] as const).map((v) => (
          <Link
            key={v}
            href={`/dashboard/bookings?view=${v}`}
            aria-current={view === v ? "page" : undefined}
            className={cn("rounded-full border px-3 py-1 text-sm capitalize", view === v ? "border-foreground bg-foreground text-background" : "hover:bg-muted")}
          >
            {v}
          </Link>
        ))}
      </nav>
      {bookings.length === 0 ? (
        <EmptyState
          title={view === "upcoming" ? "No upcoming bookings" : "No past bookings"}
          description={view === "upcoming" ? "Share your booking link and they'll appear here." : "Finished appointments will be listed here."}
        />
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
                  <td className={cn("p-3", STATUS_STYLE[b.status])}>{b.status.replace("_", " ").toLowerCase()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
