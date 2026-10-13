import type { Metadata } from "next";
import Link from "next/link";
import { DetailList } from "@/components/dashboard/detail-list";
import { orNotFound } from "@/lib/not-found";
import * as customerService from "@/services/customer.service";
import { requireTenantContext } from "@/services/session.service";

export const metadata: Metadata = { title: "Customer" };

export default async function CustomerPage({ params }: PageProps<"/dashboard/customers/[id]">) {
  const { id } = await params;
  const ctx = await requireTenantContext("customers:read");
  const c = await orNotFound(customerService.getCustomer(ctx, id));
  return (
    <section className="space-y-4">
      <Link href="/dashboard/customers" className="text-sm underline underline-offset-4">
        ← All customers
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">{c.name}</h1>
      <DetailList
        items={[
          { label: "Email", value: c.email },
          { label: "Phone", value: c.phone ?? "—" },
        ]}
      />
    </section>
  );
}
