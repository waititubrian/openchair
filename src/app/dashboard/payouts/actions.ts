"use server";

import { refresh } from "next/cache";
import { toActionError, type ActionResult } from "@/lib/action-result";
import { field } from "@/lib/form-data";
import * as payoutsService from "@/services/payouts.service";
import { requireTenantContext } from "@/services/session.service";

// OWNER only (payouts:manage).
export async function savePayoutPhoneAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ctx = await requireTenantContext("payouts:manage");
  try {
    await payoutsService.setPayoutPhone(ctx, field(formData, "phone"));
  } catch (e) {
    return toActionError(e);
  }
  refresh();
  return { ok: true };
}

export async function clearPayoutPhoneAction(): Promise<ActionResult> {
  const ctx = await requireTenantContext("payouts:manage");
  try {
    await payoutsService.clearPayoutPhone(ctx);
  } catch (e) {
    return toActionError(e);
  }
  refresh();
  return { ok: true };
}
