import { handle } from "@/lib/http";
import * as billingService from "@/services/billing.service";
import { requireApiTenantContext } from "@/services/session.service";

// OWNER only.
export async function GET() {
  return handle(async () => {
    const ctx = await requireApiTenantContext("billing:manage");
    return Response.json(await billingService.getBillingSummary(ctx));
  });
}
