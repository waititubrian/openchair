import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { EmptyState } from "@/components/dashboard/empty-state";
import { formatMoney } from "@/lib/money";
import { orNotFound } from "@/lib/not-found";
import { servicePath } from "@/lib/booking-links";
import * as publicBooking from "@/services/public-booking.service";

export const metadata: Metadata = { title: "Book an appointment" };

export default function ShopPage({ params }: PageProps<"/b/[tenantSlug]">) {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-lg bg-muted" aria-busy="true" />}>
      <Services params={params} />
    </Suspense>
  );
}

async function Services({ params }: Pick<PageProps<"/b/[tenantSlug]">, "params">) {
  const { tenantSlug } = await params;
  const { shop, services } = await orNotFound(publicBooking.getShop(tenantSlug));
  return (
    <section className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">{shop.name}</h1>
        <p className="mt-1 text-muted-foreground">Choose a service to book your appointment.</p>
      </header>
      {services.length === 0 ? (
        <EmptyState title="Online booking isn't available yet" description="This shop hasn't set up bookable services. Please contact them directly." />
      ) : (
        <ul className="grid gap-3">
          {services.map((s) => (
            <li key={s.id}>
              <Link
                href={servicePath(shop.slug, s.id)}
                className="block rounded-lg border p-4 transition hover:border-foreground/40 hover:bg-muted/40 focus-visible:outline-2"
              >
                <div className="flex items-baseline justify-between gap-4">
                  <span className="font-medium">{s.name}</span>
                  <span className="shrink-0 text-sm">{formatMoney(s.priceCents, shop.currency)}</span>
                </div>
                {s.description && <p className="mt-1 text-sm text-muted-foreground">{s.description}</p>}
                <p className="mt-2 text-xs text-muted-foreground">
                  {s.durationMin} minutes
                  {shop.depositOnline && s.depositCents > 0 && ` · ${formatMoney(s.depositCents, shop.currency)} deposit to book`}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
