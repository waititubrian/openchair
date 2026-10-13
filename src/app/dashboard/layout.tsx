import Link from "next/link";
import { Suspense } from "react";
import { DASHBOARD_NAV } from "@/components/dashboard/nav-config";
import { DashboardSkeleton } from "@/components/dashboard/dashboard-skeleton";
import { SidebarNav } from "@/components/dashboard/sidebar-nav";
import { SignOutButton } from "@/components/dashboard/sign-out-button";
import { can } from "@/lib/permissions";
import { requireTenantContext } from "@/services/session.service";

export default function DashboardLayout({ children }: LayoutProps<"/dashboard">) {
  // The session read is request-time data, so it streams in behind Suspense
  // (Next.js Cache Components) instead of blocking the whole layout.
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <DashboardShell>{children}</DashboardShell>
    </Suspense>
  );
}

async function DashboardShell({ children }: { children: React.ReactNode }) {
  const ctx = await requireTenantContext();
  const items = DASHBOARD_NAV.filter((i) => can(ctx.role, i.permission));
  return (
    <div className="flex flex-1 flex-col md:flex-row">
      <aside className="flex flex-col gap-4 border-b p-4 md:w-56 md:border-r md:border-b-0">
        <div>
          <p className="truncate font-semibold">{ctx.tenant.name}</p>
          <p className="text-xs text-muted-foreground">{ctx.role === "OWNER" ? "Owner" : "Staff"}</p>
        </div>
        <SidebarNav items={items} />
        <div className="mt-auto flex items-center justify-between gap-2 md:flex-col md:items-start">
          <Link href={`/b/${ctx.tenant.slug}`} className="text-sm underline underline-offset-4">
            Public booking page
          </Link>
          <SignOutButton />
        </div>
      </aside>
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
