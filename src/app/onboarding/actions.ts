"use server";

import { redirect } from "next/navigation";
import { toActionError, type ActionResult } from "@/lib/action-result";
import { requireUser } from "@/services/session.service";
import * as tenantService from "@/services/tenant.service";
import { onboardingInput } from "@/validators/tenant";

export async function checkSlugAction(slug: string) {
  await requireUser(); // signed-in users only, so this can't be used to enumerate shops anonymously
  return tenantService.isSlugAvailable(slug);
}

export async function onboardAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  try {
    const input = onboardingInput.parse(JSON.parse(String(formData.get("payload"))));
    await tenantService.onboard(user.id, input);
  } catch (e) {
    return toActionError(e);
  }
  redirect("/dashboard");
}
