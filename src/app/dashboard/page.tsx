import type { Metadata } from "next";
import Link from "next/link";
import { env } from "@/lib/env";
import { can } from "@/lib/permissions";
import { PLANS } from "@/lib/constants/business";
import { requireTenantContext } from "@/services/session.service";

export const metadata: Metadata = { title: "Overview" };

export default async function DashboardPage() {
  const { tenant, user, role } = await requireTenantContext("bookings:read");
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
      {can(role, "payouts:manage") && !tenant.chargesEnabled && (
        <div role="note" className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          <p className="font-medium">Collect deposits by card</p>
          <p className="mt-1">
            Connect your payouts so customers can pay a deposit when they book.{" "}
            <Link href="/dashboard/payouts" className="underline underline-offset-4">
              Set up payouts
            </Link>
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
