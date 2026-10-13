import type { Metadata } from "next";
import { ComingSoon } from "@/components/dashboard/coming-soon";
import { requireTenantContext } from "@/services/session.service";

export const metadata: Metadata = { title: "Billing" };

export default async function Page() {
  await requireTenantContext("billing:manage");
  return <ComingSoon title="Billing" description="Your plan and invoices." />;
}
