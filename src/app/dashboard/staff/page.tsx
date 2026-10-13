import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/dashboard/empty-state";
import * as staffService from "@/services/staff.service";
import { requireTenantContext } from "@/services/session.service";

export const metadata: Metadata = { title: "Staff" };

export default async function StaffPage() {
  const ctx = await requireTenantContext("staff:read");
  const staff = await staffService.listStaff(ctx);
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Staff</h1>
      {staff.length === 0 ? (
        <EmptyState title="No staff yet" description="Add the people who take bookings." />
      ) : (
        <ul className="divide-y rounded-lg border">
          {staff.map((m) => (
            <li key={m.id} className="flex items-center justify-between p-3 text-sm">
              <Link href={`/dashboard/staff/${m.id}`} className="font-medium underline underline-offset-4">
                {m.name}
              </Link>
              <span className="text-muted-foreground">{m.active ? "Active" : "Inactive"}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
