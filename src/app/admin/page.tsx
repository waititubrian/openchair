import type { Metadata } from "next";
import { Suspense } from "react";
import { ComingSoon } from "@/components/dashboard/coming-soon";
import { requirePlatformAdmin } from "@/services/session.service";

export const metadata: Metadata = { title: "Platform admin" };

export default function AdminPage() {
  return (
    <main className="mx-auto w-full max-w-4xl p-6">
      <Suspense fallback={<div className="h-40 animate-pulse rounded-md bg-muted" aria-busy="true" />}>
        <AdminBody />
      </Suspense>
    </main>
  );
}

async function AdminBody() {
  await requirePlatformAdmin();
  return <ComingSoon title="Platform admin" description="Tenants, plans, booking counts and platform fee revenue arrive in Phase 7." />;
}
