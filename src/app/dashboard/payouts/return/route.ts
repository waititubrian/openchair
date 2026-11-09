import { redirect } from "next/navigation";
import * as payoutsService from "@/services/payouts.service";
import { requireTenantContext } from "@/services/session.service";

// Stripe sends the owner here when they leave onboarding. That does NOT mean they finished, so we
// re-read the account from Stripe, then show the payouts page with the real status.
export async function GET() {
  const ctx = await requireTenantContext("payouts:manage");
  try {
    await payoutsService.refreshStatus(ctx);
  } catch (e) {
    console.error("payout status refresh failed", e);
  }
  redirect("/dashboard/payouts");
}
