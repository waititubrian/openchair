import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { DetailList } from "@/components/dashboard/detail-list";
import { AutoRefresh } from "@/components/public/auto-refresh";
import { PayDepositButton } from "@/components/public/pay-deposit-button";
import { formatMoney } from "@/lib/money";
import { orNotFound } from "@/lib/not-found";
import { formatInZone } from "@/lib/time";
import * as paymentService from "@/services/payment.service";
import * as publicBooking from "@/services/public-booking.service";
import { payDepositAction } from "../../actions";

// Anyone with the link can view it, but it is unguessable and must never be indexed.
export const metadata: Metadata = { title: "Booking confirmation", robots: { index: false, follow: false } };

export default function ConfirmationPage({ params, searchParams }: PageProps<"/b/[tenantSlug]/confirmation/[token]">) {
  return (
    <Suspense fallback={<div className="h-72 animate-pulse rounded-lg bg-muted" aria-busy="true" />}>
      <Confirmation params={params} searchParams={searchParams} />
    </Suspense>
  );
}

const HEADINGS: Record<string, { title: string; note: string }> = {
  CONFIRMED: { title: "You're booked!", note: "Your appointment is confirmed. See you then." },
  PENDING_PAYMENT: { title: "Almost there", note: "Your time is held while you complete the deposit payment." },
  CANCELLED: { title: "This booking was cancelled", note: "The time is no longer reserved. You're welcome to book another." },
  COMPLETED: { title: "Appointment completed", note: "Thanks for visiting." },
  NO_SHOW: { title: "Appointment missed", note: "This appointment was marked as a no-show." },
};

async function Confirmation({ params, searchParams }: Pick<PageProps<"/b/[tenantSlug]/confirmation/[token]">, "params" | "searchParams">) {
  const { tenantSlug, token } = await params;
  const sp = await searchParams;
  const returnedFromStripe = sp.paid === "1";
  const cancelledAtStripe = sp.canceled === "1";

  let { shop, booking: b } = await orNotFound(publicBooking.getConfirmation(tenantSlug, token));

  // Back from Stripe but still marked pending: the webhook may be a moment behind. Ask Stripe
  // directly (the webhook stays the source of truth; whichever lands second changes nothing).
  if (b.status === "PENDING_PAYMENT" && returnedFromStripe) {
    try {
      await paymentService.reconcileBooking(tenantSlug, token);
    } catch (e) {
      console.error("payment reconcile failed", e);
    }
    ({ shop, booking: b } = await publicBooking.getConfirmation(tenantSlug, token));
  }

  const confirming = b.status === "PENDING_PAYMENT" && returnedFromStripe;
  const h = HEADINGS[b.status];
  const tz = shop.timezone;
  const holdUntil = b.holdExpiresAt ? formatInZone(b.holdExpiresAt, tz, "h:mm a") : null;

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">{confirming ? "Confirming your payment…" : h.title}</h1>
        <p className="mt-1 text-muted-foreground">
          {b.firstName},{" "}
          {confirming
            ? "we're waiting for Stripe to confirm your deposit. This page updates by itself."
            : b.status === "PENDING_PAYMENT" && !b.payable
              ? "the time we were holding for you has been released. Please book again."
              : h.note}
        </p>
      </div>
      {confirming && <AutoRefresh />}

      {b.status === "PENDING_PAYMENT" && b.payable && !confirming && (
        <div className="space-y-3 rounded-lg border p-4">
          {cancelledAtStripe && <p className="text-sm">Your payment wasn&apos;t completed.</p>}
          <p className="text-sm text-muted-foreground">
            Deposit due: <strong>{formatMoney(b.depositCents, shop.currency)}</strong>
            {holdUntil && <> · your time is held until {holdUntil} ({tz})</>}
          </p>
          <PayDepositButton action={payDepositAction.bind(null, shop.slug, token)} label={`Pay ${formatMoney(b.depositCents, shop.currency)} deposit`} />
        </div>
      )}

      <DetailList
        items={[
          { label: "Shop", value: shop.name },
          { label: "Service", value: `${b.serviceName} (${b.durationMin} min)` },
          { label: "With", value: b.staffName },
          { label: "When", value: `${formatInZone(b.startsAt, tz, "EEEE d MMMM yyyy, h:mm a")} (${tz})` },
          { label: "Price", value: formatMoney(b.priceCents, shop.currency) },
          ...(b.depositCents > 0
            ? [
                {
                  label: "Deposit",
                  value: b.depositPaidOnline
                    ? `${formatMoney(b.depositCents, shop.currency)} paid online`
                    : `${formatMoney(b.depositCents, shop.currency)}${shop.depositOnline ? "" : ", paid at the shop"}`,
                },
              ]
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
