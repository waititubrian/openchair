import "server-only";
import { assertCan } from "@/lib/permissions";
import type { TenantContext } from "@/lib/tenant-context";

type Ctx = Pick<TenantContext, "role" | "tenant">;

/** Read-only Stripe Connect status. The onboarding link and webhooks arrive in Phase 5. */
export async function getPayoutStatus(ctx: Ctx) {
  assertCan(ctx, "payouts:manage");
  const t = ctx.tenant;
  return {
    connected: Boolean(t.stripeAccountId),
    detailsSubmitted: t.detailsSubmitted,
    chargesEnabled: t.chargesEnabled,
    payoutsEnabled: t.payoutsEnabled,
  };
}
