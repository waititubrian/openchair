"use server";

import { refresh } from "next/cache";
import { toActionError, type ActionResult } from "@/lib/action-result";
import { field } from "@/lib/form-data";
import * as billingService from "@/services/billing.service";
import { requireTenantContext } from "@/services/session.service";

// OWNER only (billing:manage). Sends an M-Pesa prompt to the owner's phone for one Pro period.
export async function payForProAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ctx = await requireTenantContext("billing:manage");
  try {
    await billingService.startSubscriptionPayment(ctx, field(formData, "phone"));
  } catch (e) {
    return toActionError(e);
  }
  refresh();
  return { ok: true };
}
