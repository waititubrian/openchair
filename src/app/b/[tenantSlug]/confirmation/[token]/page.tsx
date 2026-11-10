import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { DetailList } from "@/components/dashboard/detail-list";
import { AutoRefresh } from "@/components/auto-refresh";
import { MpesaPhoneForm } from "@/components/mpesa-phone-form";
import { formatMoney } from "@/lib/money";
import { failureMessage } from "@/lib/mpesa-results";
import { orNotFound } from "@/lib/not-found";
import { formatInZone } from "@/lib/time";
import * as mpesaSettlement from "@/services/mpesa-settlement.service";
import * as publicBooking from "@/services/public-booking.service";
import { payDepositAction } from "../../actions";

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
  PENDING_PAYMENT: { title: "Almost there", note: "Your time is held until the deposit is paid." },
  CANCELLED: { title: "This booking was cancelled", note: "The time is no longer reserved. You're welcome to book another." },
  COMPLETED: { title: "Appointment completed", note: "Thanks for visiting." },
  NO_SHOW: { title: "Appointment missed", note: "This appointment was marked as a no-show." },
};

async function Confirmation({ params }: Pick<PageProps<"/b/[tenantSlug]/confirmation/[token]">, "params">) {
  const { tenantSlug, token } = await params;
  await connection(); // the page depends on the current time: render per request
  let { shop, booking: b } = await orNotFound(publicBooking.getConfirmation(tenantSlug, token));

  // While an M-Pesa prompt is outstanding, ask Safaricom for its result (the callback may be a moment
  // behind or not arrive at all). The callback and this check settle through the same idempotent step.
  if (b.status === "PENDING_PAYMENT" && b.payment?.status === "PENDING") {
    try {
      await mpesaSettlement.reconcileBookingDeposit(tenantSlug, token);
    } catch (e) {
      console.error("deposit status check failed", e);
    }
    ({ shop, booking: b } = await publicBooking.getConfirmation(tenantSlug, token));
  }

  const tz = shop.timezone;
  // "Check your phone" only while the held time still exists; once the hold lapses the time is released
  // (a late approval is still honoured behind the scenes: it revives the booking or flags a refund).
  const waiting = b.status === "PENDING_PAYMENT" && b.payment?.status === "PENDING" && b.payable;
  const failed = b.status === "PENDING_PAYMENT" && b.payment?.status === "FAILED";
  const refundDue = b.status === "CANCELLED" && b.payment?.status === "NEEDS_REFUND";
  const released = b.status === "PENDING_PAYMENT" && !b.payable;
  const needsPrompt = b.status === "PENDING_PAYMENT" && b.payable && !waiting;
  const holdUntil = b.holdExpiresAt ? formatInZone(b.holdExpiresAt, tz, "h:mm a") : null;
  const h = HEADINGS[b.status];

  const title = waiting ? "Check your phone" : refundDue ? "We have your payment" : released ? "Your time was released" : h.title;
  const note = waiting
    ? `we sent an M-Pesa prompt to ${b.payment!.maskedPhone} for ${formatMoney(b.depositCents, shop.currency)}. Enter your M-Pesa PIN to confirm. This page updates by itself.`
    : refundDue
      ? "but your time was no longer available, so the booking couldn't be confirmed. The shop will refund your deposit."
      : released
        ? "the deposit wasn't paid in time, so the time was released. Please book again."
        : h.note;

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 text-muted-foreground">
          {b.firstName}, {note}
        </p>
      </div>
      {waiting && <AutoRefresh seconds={90} everyMs={3000} />}

      {(needsPrompt || failed) && (
        <div className="space-y-3 rounded-lg border p-4">
          {failed && (
            <p role="alert" className="text-sm text-red-700 dark:text-red-300">
              {failureMessage(b.payment!.failureReason)}
            </p>
          )}
          <p className="text-sm text-muted-foreground">
            Deposit due: <strong>{formatMoney(b.depositCents, shop.currency)}</strong>
            {holdUntil && <> · your time is held until {holdUntil}</>}
          </p>
          <MpesaPhoneForm
            action={payDepositAction.bind(null, shop.slug, token)}
            submitLabel={failed ? "Send M-Pesa prompt again" : `Pay ${formatMoney(b.depositCents, shop.currency)} with M-Pesa`}
            hint="You'll get a prompt on your phone. Enter your M-Pesa PIN to pay."
          />
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
                    ? `${formatMoney(b.depositCents, shop.currency)} paid with M-Pesa`
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
