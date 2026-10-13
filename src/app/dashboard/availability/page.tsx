import type { Metadata } from "next";
import { ComingSoon } from "@/components/dashboard/coming-soon";
import { requireTenantContext } from "@/services/session.service";

export const metadata: Metadata = { title: "Availability" };

export default async function Page() {
  await requireTenantContext("availability:write");
  return <ComingSoon title="Availability" description="Set weekly hours and time off." />;
}
