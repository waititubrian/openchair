"use client";

import { useState, useTransition } from "react";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/action-result";

/** Sends the customer to Stripe's hosted payment page (the server action redirects on success). */
export function PayDepositButton({ action, label }: { action: () => Promise<ActionResult>; label: string }) {
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  return (
    <div className="grid gap-2">
      <FormError message={error} />
      <Button
        size="lg"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const result = await action();
            if (!result.ok) setError(result.error);
          })
        }
      >
        {pending ? "Opening payment…" : label}
      </Button>
    </div>
  );
}
