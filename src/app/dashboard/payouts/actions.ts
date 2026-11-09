"use server";

import { redirect } from "next/navigation";
import { toActionError, type ActionResult } from "@/lib/action-result";
import * as payoutsService from "@/services/payouts.service";
import { requireTenantContext } from "@/services/session.service";

// OWNER only (payouts:manage). Both actions send the browser to a Stripe-hosted page.
export async function startOnboardingAction(): Promise<ActionResult> {
  const ctx = await requireTenantContext("payouts:manage");
  let url: string;
  try {
    ({ url } = await payoutsService.startOnboarding(ctx));
  } catch (e) {
    return toActionError(e);
  }
  redirect(url);
}

export async function openStripeDashboardAction(): Promise<ActionResult> {
  const ctx = await requireTenantContext("payouts:manage");
  let url: string;
  try {
    ({ url } = await payoutsService.createDashboardLink(ctx));
  } catch (e) {
    return toActionError(e);
  }
  redirect(url);
}
