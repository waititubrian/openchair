"use client";

import { useActionState, useState } from "react";
import { FormError } from "@/components/form-error";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/action-result";
import { SaveStatus } from "@/components/dashboard/forms/save-status";

export function PayoutPhoneForm({ action, initial }: { action: (prev: ActionResult | null, formData: FormData) => Promise<ActionResult>; initial: string }) {
  const [state, formAction, pending] = useActionState(action, null);
  const [phone, setPhone] = useState(initial);
  const errors = state && !state.ok ? state.fieldErrors : undefined;
  return (
    <form action={formAction} className="grid max-w-sm gap-3">
      {state && !state.ok && !state.fieldErrors && <FormError message={state.error} />}
      <FormField label="M-Pesa number for your payouts" name="phone" type="tel" inputMode="tel" placeholder="0712 345 678" required value={phone} onChange={(e) => setPhone(e.target.value)} errors={errors?.phone} />
      <div className="flex items-center gap-4">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save number"}
        </Button>
        <SaveStatus state={state && state.ok ? state : null} />
      </div>
    </form>
  );
}
