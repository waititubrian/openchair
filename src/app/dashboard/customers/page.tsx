import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/dashboard/empty-state";
import * as customerService from "@/services/customer.service";
import { requireTenantContext } from "@/services/session.service";

export const metadata: Metadata = { title: "Customers" };

export default async function CustomersPage() {
  const ctx = await requireTenantContext("customers:read");
  const customers = await customerService.listCustomers(ctx);
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Customers</h1>
      {customers.length === 0 ? (
        <EmptyState title="No customers yet" description="Customers appear here after their first booking." />
      ) : (
        <ul className="divide-y rounded-lg border">
          {customers.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-4 p-3 text-sm">
              <Link href={`/dashboard/customers/${c.id}`} className="font-medium underline underline-offset-4">
                {c.name}
              </Link>
              <span className="text-muted-foreground">{c.email}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
