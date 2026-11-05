import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { DetailList } from "@/components/dashboard/detail-list";
import { formatMoney } from "@/lib/money";
import { orNotFound } from "@/lib/not-found";
import { formatInZone } from "@/lib/time";
import * as publicBooking from "@/services/public-booking.service";

// Anyone with the link can view it, but it is unguessable and must never be indexed.
export const metadata: Metadata = { title: "Booking confirmation", robots: { index: false, follow: false } };

export default function ConfirmationPage({ params }: PageProps<"/b/[tenantSlug]/confirmation/[token]">) {
  return (
    <Suspense fallback={<div className="h-72 animate-pulse rounded-lg bg-muted" aria-busy="true" />}>
      <Confirmation params={params} />
    </Suspense>
  );
}

const HEADINGS: Record<string, { title: string; note: string }> = {
  CONFIRMED: { title: "You're booked!", note: "Your appointment is confirmed. See you then." },
  PENDING_PAYMENT: { title: "Almost there", note: "Your time is being held while you complete the deposit payment." },
  CANCELLED: { title: "This booking was cancelled", note: "The time is no longer reserved. You're welcome to book another." },
  COMPLETED: { title: "Appointment completed", note: "Thanks for visiting." },
  NO_SHOW: { title: "Appointment missed", note: "This appointment was marked as a no-show." },
};

async function Confirmation({ params }: Pick<PageProps<"/b/[tenantSlug]/confirmation/[token]">, "params">) {
  const { tenantSlug, token } = await params;
  const { shop, booking: b } = await orNotFound(publicBooking.getConfirmation(tenantSlug, token));
  const h = HEADINGS[b.status];
  const tz = shop.timezone;
  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">{h.title}</h1>
        <p className="mt-1 text-muted-foreground">
          {b.firstName}, {h.note}
        </p>
      </div>
      <DetailList
        items={[
          { label: "Shop", value: shop.name },
          { label: "Service", value: `${b.serviceName} (${b.durationMin} min)` },
          { label: "With", value: b.staffName },
          { label: "When", value: `${formatInZone(b.startsAt, tz, "EEEE d MMMM yyyy, h:mm a")} (${tz})` },
          { label: "Price", value: formatMoney(b.priceCents, shop.currency) },
          ...(b.depositCents > 0
            ? [{ label: "Deposit", value: `${formatMoney(b.depositCents, shop.currency)}${shop.depositOnline ? "" : ", paid at the shop"}` }]
            : []),
        ]}
      />
      <p className="text-sm text-muted-foreground">Need to change or cancel? Please contact {shop.name} directly.</p>
      <Link href={`/b/${shop.slug}`} className="inline-block text-sm underline underline-offset-4">
        Book another appointment
      </Link>
    </section>
  );
}
