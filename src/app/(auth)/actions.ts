"use server";

import { redirect } from "next/navigation";
import { toActionError, type ActionResult } from "@/lib/action-result";
import { safeNextPath } from "@/lib/redirect";
import * as authService from "@/services/auth.service";
import { signInInput, signUpInput } from "@/validators/auth";

// Pick back the non-secret fields so the form can refill them. Never echo passwords.
function echo(formData: FormData, keys: string[]): Record<string, string> {
  return Object.fromEntries(keys.map((k) => [k, String(formData.get(k) ?? "")]));
}

// Thin: validate -> call service -> return result (or redirect on success).
// redirect() throws by design, so it must stay outside the try/catch.

export async function signUpAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    await authService.signUp(signUpInput.parse(Object.fromEntries(formData)));
  } catch (e) {
    return { ...toActionError(e), values: echo(formData, ["name", "email"]) };
  }
  redirect("/onboarding");
}

export async function signInAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    await authService.signIn(signInInput.parse(Object.fromEntries(formData)));
  } catch (e) {
    return { ...toActionError(e), values: echo(formData, ["email"]) };
  }
  redirect(safeNextPath(formData.get("next")));
}

export async function signOutAction(): Promise<void> {
  await authService.signOut();
  redirect("/login");
}
