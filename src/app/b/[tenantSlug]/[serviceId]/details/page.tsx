import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { BookingForm } from "@/components/public/booking-form";
import { servicePath } from "@/lib/booking-links";
import { formatMoney } from "@/lib/money";
import { orNotFound } from "@/lib/not-found";
import { formatInZone } from "@/lib/time";
import * as publicBooking from "@/services/public-booking.service";
import { createBookingAction } from "../../actions";

export const metadata: Metadata = { title: "Your details" };

export default function DetailsPage({ params, searchParams }: PageProps<"/b/[tenantSlug]/[serviceId]/details">) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-lg bg-muted" aria-busy="true" />}>
      <Details params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Details({ params, searchParams }: Pick<PageProps<"/b/[tenantSlug]/[serviceId]/details">, "params" | "searchParams">) {
  const { tenantSlug, serviceId } = await params;
  const raw = await searchParams;
  const start = Array.isArray(raw.start) ? raw.start[0] : raw.start;
  const staffParam = (Array.isArray(raw.staff) ? raw.staff[0] : raw.staff) || "any";

  const { shop, service, staff } = await orNotFound(publicBooking.getBookableService(tenantSlug, serviceId));
  const startsAt = start ? new Date(start) : null;
  const pickerHref = servicePath(shop.slug, service.id, { staff: staffParam });
  if (!startsAt || Number.isNaN(startsAt.getTime())) redirect(pickerHref);

  const who = staffParam === "any" ? "First available" : (staff.find((s) => s.id === staffParam)?.name ?? "First available");
  return (
    <section className="space-y-6">
      <div>
        <Link href={pickerHref} className="text-sm underline underline-offset-4">
          ← Change time
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Almost done</h1>
      </div>
      <dl className="grid gap-2 rounded-lg border p-4 text-sm sm:grid-cols-[7rem_1fr]">
        <dt className="text-muted-foreground">Service</dt>
        <dd>
          {service.name} ({service.durationMin} min)
        </dd>
        <dt className="text-muted-foreground">When</dt>
        <dd>
          {formatInZone(startsAt, shop.timezone, "EEEE d MMMM yyyy, h:mm a")} <span className="text-muted-foreground">({shop.timezone})</span>
        </dd>
        <dt className="text-muted-foreground">With</dt>
        <dd>{who}</dd>
        <dt className="text-muted-foreground">Price</dt>
        <dd>
          {formatMoney(service.priceCents, shop.currency)}
          {service.depositCents > 0 && (
            <span className="text-muted-foreground">
              {shop.depositOnline
                ? ` · ${formatMoney(service.depositCents, shop.currency)} deposit, paid now by M-Pesa`
                : ` · ${formatMoney(service.depositCents, shop.currency)} deposit, paid at the shop`}
            </span>
          )}
        </dd>
      </dl>
      <BookingForm
        action={createBookingAction}
        pickerHref={pickerHref}
        depositNow={shop.depositOnline && service.depositCents > 0}
        hidden={{ tenantSlug: shop.slug, serviceId: service.id, staff: staffParam, startsAt: startsAt.toISOString() }}
      />
    </section>
  );
}
