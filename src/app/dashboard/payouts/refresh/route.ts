import { redirect } from "next/navigation";
import * as payoutsService from "@/services/payouts.service";
import { requireTenantContext } from "@/services/session.service";

// Stripe sends the owner here when an onboarding link expired or was already used (links are
// single-use). Issue a fresh one and send them straight back into onboarding.
export async function GET() {
  const ctx = await requireTenantContext("payouts:manage");
  let url: string;
  try {
    ({ url } = await payoutsService.startOnboarding(ctx));
  } catch (e) {
    console.error("could not restart payout onboarding", e);
    redirect("/dashboard/payouts?error=1");
  }
  redirect(url);
}
