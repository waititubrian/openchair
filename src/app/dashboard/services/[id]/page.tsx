import type { Metadata } from "next";
import Link from "next/link";
import { DetailList } from "@/components/dashboard/detail-list";
import { orNotFound } from "@/lib/not-found";
import { formatMoney } from "@/lib/money";
import * as catalogService from "@/services/catalog.service";
import { requireTenantContext } from "@/services/session.service";

export const metadata: Metadata = { title: "Service" };

export default async function ServicePage({ params }: PageProps<"/dashboard/services/[id]">) {
  const { id } = await params;
  const ctx = await requireTenantContext("services:read");
  const s = await orNotFound(catalogService.getService(ctx, id));
  return (
    <section className="space-y-4">
      <Link href="/dashboard/services" className="text-sm underline underline-offset-4">
        ← All services
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">{s.name}</h1>
      <DetailList
        items={[
          { label: "Duration", value: `${s.durationMin} minutes` },
          { label: "Price", value: formatMoney(s.priceCents, ctx.tenant.currency) },
          { label: "Deposit", value: formatMoney(s.depositCents, ctx.tenant.currency) },
          { label: "Status", value: s.active ? "Active" : "Inactive" },
        ]}
      />
    </section>
  );
}
