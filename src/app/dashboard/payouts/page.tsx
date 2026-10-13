import type { Metadata } from "next";
import { ComingSoon } from "@/components/dashboard/coming-soon";
import { requireTenantContext } from "@/services/session.service";

export const metadata: Metadata = { title: "Payouts" };

export default async function Page() {
  await requireTenantContext("payouts:manage");
  return <ComingSoon title="Payouts" description="Connect Stripe to receive deposits." />;
}
