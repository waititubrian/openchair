import type { Metadata } from "next";
import Link from "next/link";
import { DetailList } from "@/components/dashboard/detail-list";
import { ConfirmDeleteButton } from "@/components/dashboard/forms/confirm-delete";
import { formatMoney } from "@/lib/money";
import { orNotFound } from "@/lib/not-found";
import { can } from "@/lib/permissions";
import { formatInZone } from "@/lib/time";
import * as bookingService from "@/services/booking.service";
import { requireTenantContext } from "@/services/session.service";
import { setBookingStatusAction } from "../actions";

export const metadata: Metadata = { title: "Booking" };

export default async function BookingPage({ params }: PageProps<"/dashboard/bookings/[id]">) {
  const { id } = await params;
  const ctx = await requireTenantContext("bookings:read");
  const b = await orNotFound(bookingService.getBooking(ctx, id));
  const canWrite = can(ctx.role, "bookings:write");
  const started = b.startsAt <= new Date();
  const cancellable = b.status === "CONFIRMED" || b.status === "PENDING_PAYMENT";

  return (
    <section className="space-y-4">
      <Link href="/dashboard/bookings" className="text-sm underline underline-offset-4">
        ← All bookings
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">{b.service.name}</h1>
      <DetailList
        items={[
          { label: "When", value: `${formatInZone(b.startsAt, ctx.tenant.timezone)} (${ctx.tenant.timezone})` },
          { label: "Customer", value: `${b.customer.name} · ${b.customer.email}${b.customer.phone ? ` · ${b.customer.phone}` : ""}` },
          { label: "With", value: b.staff.name },
          { label: "Status", value: b.status.replace("_", " ").toLowerCase() },
          { label: "Price", value: formatMoney(b.priceCents, ctx.tenant.currency) },
          { label: "Deposit", value: formatMoney(b.depositCents, ctx.tenant.currency) },
        ]}
      />
      {canWrite && (cancellable || b.status === "CONFIRMED") && (
        <div className="flex max-w-xl flex-wrap items-start gap-3 border-t pt-4">
          {b.status === "CONFIRMED" && started && (
            <>
              <ConfirmDeleteButton action={setBookingStatusAction.bind(null, id, "COMPLETED")} label="Mark completed" askFirst={false} />
              <ConfirmDeleteButton action={setBookingStatusAction.bind(null, id, "NO_SHOW")} label="Mark no-show" askFirst={false} />
            </>
          )}
          {cancellable && (
            <ConfirmDeleteButton action={setBookingStatusAction.bind(null, id, "CANCELLED")} label="Cancel booking" confirmLabel="Yes, cancel it" />
          )}
        </div>
      )}
      {canWrite && b.status === "CONFIRMED" && !started && (
        <p className="text-sm text-muted-foreground">Completed and no-show become available once the appointment has started.</p>
      )}
    </section>
  );
}
