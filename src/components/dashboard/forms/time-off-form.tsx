"use client";

import { useActionState, useState } from "react";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/action-result";
import { SaveStatus } from "./save-status";

const BLANK = { startLocal: "", endLocal: "", reason: "" };

export function TimeOffForm({
  action,
  timezone,
}: {
  action: (prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;
  timezone: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const [v, setV] = useState(BLANK);
  const [handled, setHandled] = useState<ActionResult | null>(null);
  // After a successful add, clear the fields (derived-state pattern: adjust during render).
  if (state?.ok && state !== handled) {
    setHandled(state);
    setV(BLANK);
  }
  const errors = state && !state.ok ? state.fieldErrors : undefined;

  return (
    <form action={formAction} className="grid max-w-xl gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField
          label="From"
          name="startLocal"
          type="datetime-local"
          value={v.startLocal}
          onChange={(e) => setV({ ...v, startLocal: e.target.value })}
          errors={errors?.startLocal}
          required
        />
        <FormField
          label="Until"
          name="endLocal"
          type="datetime-local"
          value={v.endLocal}
          onChange={(e) => setV({ ...v, endLocal: e.target.value })}
          errors={errors?.endLocal}
          required
        />
      </div>
      <FormField label="Reason (optional)" name="reason" value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} />
      <p className="text-xs text-muted-foreground">Times are in the shop&apos;s timezone ({timezone}).</p>
      {state && !state.ok && !state.fieldErrors && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      )}
      <div className="flex items-center gap-4">
        <Button type="submit" disabled={pending}>
          {pending ? "Adding…" : "Add time off"}
        </Button>
        <SaveStatus state={state && state.ok ? state : null} />
      </div>
    </form>
  );
}
