"use client";

import Link from "next/link";
import { useActionState } from "react";
import { FormError } from "@/components/form-error";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/action-result";
import { signUpAction } from "../actions";

export function SignupForm() {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(signUpAction, null);
  const errors = state && !state.ok ? state.fieldErrors : undefined;
  const values = state && !state.ok ? state.values : undefined;
  return (
    <form action={action} className="grid gap-4">
      <FormError message={state && !state.ok ? state.error : undefined} />
      <FormField label="Your name" name="name" autoComplete="name" required defaultValue={values?.name} errors={errors?.name} />
      <FormField
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        required
        defaultValue={values?.email}
        errors={errors?.email}
      />
      <FormField
        label="Password"
        name="password"
        type="password"
        autoComplete="new-password"
        minLength={8}
        required
        errors={errors?.password}
      />
      <Button type="submit" disabled={pending}>
        {pending ? "Creating account…" : "Create account"}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="underline underline-offset-4">
          Sign in
        </Link>
      </p>
    </form>
  );
}
