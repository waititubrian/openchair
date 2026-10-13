import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/dashboard/empty-state";
import { formatMoney } from "@/lib/money";
import * as catalogService from "@/services/catalog.service";
import { requireTenantContext } from "@/services/session.service";

export const metadata: Metadata = { title: "Services" };

export default async function ServicesPage() {
  const ctx = await requireTenantContext("services:read");
  const services = await catalogService.listServices(ctx);
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Services</h1>
      {services.length === 0 ? (
        <EmptyState title="No services yet" description="Add what you offer so customers can book it." />
      ) : (
        <ul className="divide-y rounded-lg border">
          {services.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-4 p-3 text-sm">
              <Link href={`/dashboard/services/${s.id}`} className="font-medium underline underline-offset-4">
                {s.name}
              </Link>
              <span className="text-muted-foreground">
                {s.durationMin} min · {formatMoney(s.priceCents, ctx.tenant.currency)} · {formatMoney(s.depositCents, ctx.tenant.currency)} deposit
                {!s.active && " · inactive"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
