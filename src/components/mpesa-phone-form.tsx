"use client";

import { useActionState, useState } from "react";
import { FormError } from "@/components/form-error";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/action-result";

/** Asks for an M-Pesa number and sends the payment prompt (the action does the sending). */
export function MpesaPhoneForm({
  action,
  label,
  submitLabel = "Send M-Pesa prompt",
  hint,
}: {
  action: (prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;
  label?: string;
  submitLabel?: string;
  hint?: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const [phone, setPhone] = useState("");
  const errors = state && !state.ok ? state.fieldErrors : undefined;
  return (
    <form action={formAction} className="grid gap-3">
      {state && !state.ok && !state.fieldErrors && <FormError message={state.error} />}
      <FormField
        label={label ?? "M-Pesa phone number"}
        name="phone"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        placeholder="0712 345 678"
        required
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        errors={errors?.phone}
      />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      <Button type="submit" disabled={pending}>
        {pending ? "Sending prompt…" : submitLabel}
      </Button>
    </form>
  );
}
