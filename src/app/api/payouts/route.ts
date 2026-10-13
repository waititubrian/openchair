import { handle } from "@/lib/http";
import * as payoutsService from "@/services/payouts.service";
import { requireApiTenantContext } from "@/services/session.service";

// OWNER only.
export async function GET() {
  return handle(async () => {
    const ctx = await requireApiTenantContext("payouts:manage");
    return Response.json(await payoutsService.getPayoutStatus(ctx));
  });
}
