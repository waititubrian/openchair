import "server-only";
import { PLANS } from "@/lib/constants/business";
import { PlanLimitError } from "@/lib/errors";
import type { TenantContext } from "@/lib/tenant-context";
import * as staffRepo from "@/repositories/staff.repo";
import type { Tx } from "@/repositories/transaction";

// Plan limits are enforced here, server-side, never only in the UI. Limits come from
// src/lib/constants/business.ts. (The monthly booking limit is added in Phase 6.)

/** Throws PlanLimitError when adding/reactivating one more ACTIVE staff member would exceed the plan. */
export async function assertCanAddActiveStaff(ctx: Pick<TenantContext, "tenantId" | "tenant">, tx?: Tx) {
  const plan = PLANS[ctx.tenant.plan];
  if (!Number.isFinite(plan.maxStaff)) return;
  const active = await staffRepo.countActive(ctx.tenantId, tx);
  if (active >= plan.maxStaff) {
    throw new PlanLimitError(
      `The ${plan.label} plan includes ${plan.maxStaff} staff member${plan.maxStaff === 1 ? "" : "s"}. Upgrade to Pro to add more.`,
    );
  }
}
