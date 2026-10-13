import type { Metadata } from "next";
import Link from "next/link";
import { DetailList } from "@/components/dashboard/detail-list";
import { orNotFound } from "@/lib/not-found";
import { formatMoney } from "@/lib/money";
import { formatInZone } from "@/lib/time";
import * as bookingService from "@/services/booking.service";
import { requireTenantContext } from "@/services/session.service";

export const metadata: Metadata = { title: "Booking" };

export default async function BookingPage({ params }: PageProps<"/dashboard/bookings/[id]">) {
  const { id } = await params;
  const ctx = await requireTenantContext("bookings:read");
  const b = await orNotFound(bookingService.getBooking(ctx, id));
  return (
    <section className="space-y-4">
      <Link href="/dashboard/bookings" className="text-sm underline underline-offset-4">
        ← All bookings
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">{b.service.name}</h1>
      <DetailList
        items={[
          { label: "When", value: `${formatInZone(b.startsAt, ctx.tenant.timezone)} (${ctx.tenant.timezone})` },
          { label: "Customer", value: `${b.customer.name} · ${b.customer.email}` },
          { label: "With", value: b.staff.name },
          { label: "Status", value: b.status.replace("_", " ").toLowerCase() },
          { label: "Price", value: formatMoney(b.priceCents, ctx.tenant.currency) },
          { label: "Deposit", value: formatMoney(b.depositCents, ctx.tenant.currency) },
        ]}
      />
    </section>
  );
}
