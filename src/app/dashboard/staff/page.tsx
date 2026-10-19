import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/dashboard/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { PLANS } from "@/lib/constants/business";
import { can } from "@/lib/permissions";
import { requireTenantContext } from "@/services/session.service";
import * as staffService from "@/services/staff.service";

export const metadata: Metadata = { title: "Staff" };

export default async function StaffPage() {
  const ctx = await requireTenantContext("staff:read");
  const staff = await staffService.listStaff(ctx);
  const canWrite = can(ctx.role, "staff:write");
  const plan = PLANS[ctx.tenant.plan];
  const active = staff.filter((m) => m.active).length;
  const limited = Number.isFinite(plan.maxStaff);
  const atLimit = limited && active >= plan.maxStaff;

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Staff</h1>
          {limited && (
            <p className="text-sm text-muted-foreground">
              {active} of {plan.maxStaff} active staff on the {plan.label} plan
            </p>
          )}
        </div>
        {canWrite && !atLimit && (
          <Link href="/dashboard/staff/new" className={buttonVariants({ size: "sm" })}>
            Add staff member
          </Link>
        )}
      </div>
      {canWrite && atLimit && (
        <p role="note" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          The {plan.label} plan includes {plan.maxStaff} staff member{plan.maxStaff === 1 ? "" : "s"}. Upgrade to Pro to add more.
        </p>
      )}
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
