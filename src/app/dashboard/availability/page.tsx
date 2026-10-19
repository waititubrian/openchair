import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { EmptyState } from "@/components/dashboard/empty-state";
import { requireTenantContext } from "@/services/session.service";
import * as staffService from "@/services/staff.service";

export const metadata: Metadata = { title: "Availability" };

export default async function AvailabilityPage() {
  const ctx = await requireTenantContext("availability:write");

  if (ctx.role !== "OWNER") {
    // STAFF manage only their own schedule: go straight to it.
    const own = await staffService.getOwnStaffMember(ctx);
    if (own) redirect(`/dashboard/staff/${own.id}#hours`);
    return (
      <section className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Availability</h1>
        <EmptyState
          title="You're not set up as bookable"
          description="Ask the shop owner to link your login to a staff member so you can set your hours."
        />
      </section>
    );
  }

  const staff = await staffService.listStaff(ctx);
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Availability</h1>
      <p className="text-sm text-muted-foreground">Choose a staff member to set their weekly hours and time off.</p>
      {staff.length === 0 ? (
        <EmptyState title="No staff yet" description="Add a staff member first." />
      ) : (
        <ul className="divide-y rounded-lg border">
          {staff.map((m) => (
            <li key={m.id} className="flex items-center justify-between p-3 text-sm">
              <span className="font-medium">{m.name}</span>
              <span className="flex gap-4">
                <Link href={`/dashboard/staff/${m.id}#hours`} className="underline underline-offset-4">
                  Weekly hours
                </Link>
                <Link href={`/dashboard/staff/${m.id}#time-off`} className="underline underline-offset-4">
                  Time off
                </Link>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
