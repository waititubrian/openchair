import "server-only";
import { assertCan } from "@/lib/permissions";
import type { TenantContext } from "@/lib/tenant-context";
import { PLANS } from "@/lib/constants/business";
import * as subscriptionRepo from "@/repositories/subscription.repo";

type Ctx = Pick<TenantContext, "tenantId" | "role" | "tenant">;

/** Read-only plan summary. Checkout and the customer portal are added in Phase 6. */
export async function getBillingSummary(ctx: Ctx) {
  assertCan(ctx, "billing:manage");
  const sub = await subscriptionRepo.findByTenant(ctx.tenantId);
  return {
    plan: ctx.tenant.plan,
    planLabel: PLANS[ctx.tenant.plan].label,
    subscription: sub && {
      status: sub.status,
      currentPeriodEnd: sub.currentPeriodEnd,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
    },
  };
}
