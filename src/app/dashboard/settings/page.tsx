import type { Metadata } from "next";
import { ComingSoon } from "@/components/dashboard/coming-soon";
import { requireTenantContext } from "@/services/session.service";

export const metadata: Metadata = { title: "Settings" };

export default async function Page() {
  await requireTenantContext("settings:manage");
  return <ComingSoon title="Settings" description="Shop name, address and timezone." />;
}
