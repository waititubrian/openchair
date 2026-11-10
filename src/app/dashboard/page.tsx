import type { Metadata } from "next";
import Link from "next/link";
import { env } from "@/lib/env";
import { can } from "@/lib/permissions";
import { PLANS } from "@/lib/constants/business";
import * as planService from "@/services/plan.service";
import { requireTenantContext } from "@/services/session.service";

export const metadata: Metadata = { title: "Overview" };

export default async function DashboardPage() {
  const ctx = await requireTenantContext("bookings:read");
  const { tenant, user, role } = ctx;
  const usage = await planService.getBookingUsage({ tenantId: ctx.tenantId, tenant });
  const publicUrl = `${env.APP_URL}/b/${tenant.slug}`;
  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Welcome, {user.name.split(" ")[0]}</h1>
        <p className="text-sm text-muted-foreground">
          {tenant.name} · {PLANS[tenant.plan].label} plan · {tenant.timezone}
        </p>
      </div>
      <div className="rounded-lg border p-4">
        <p className="text-sm font-medium">Your booking link</p>
        <Link href={`/b/${tenant.slug}`} className="break-all text-sm underline underline-offset-4">
          {publicUrl}
        </Link>
        <p className="mt-1 text-xs text-muted-foreground">Share it with customers. They book and pay a deposit without an account.</p>
      </div>
      {can(role, "payouts:manage") && !tenant.payoutPhone && (
        <div role="note" className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          <p className="font-medium">Collect deposits by M-Pesa</p>
          <p className="mt-1">
            Add your M-Pesa number so customers can pay a deposit when they book.{" "}
            <Link href="/dashboard/payouts" className="underline underline-offset-4">
              Set up payouts
            </Link>
          </p>
        </div>
      )}
      {usage.limit !== null && usage.used >= Math.floor(usage.limit * 0.8) && can(role, "billing:manage") && (
        <div role="note" className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          <p className="font-medium">
            {usage.used >= usage.limit ? "You've reached this month's booking limit" : `${usage.used} of ${usage.limit} bookings used this month`}
          </p>
          <p className="mt-1">
            {usage.used >= usage.limit ? "Customers can't book online until next month. " : ""}
            <Link href="/dashboard/billing" className="underline underline-offset-4">
              Upgrade to Pro
            </Link>{" "}
            for unlimited bookings and staff.
          </p>
        </div>
      )}
      {role === "OWNER" && (
        <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          Bookings, analytics and payouts appear here as you finish setup.
        </div>
      )}
    </section>
  );
}
