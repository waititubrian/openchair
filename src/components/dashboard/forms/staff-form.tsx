"use client";

import { useActionState, useState } from "react";
import { FormError } from "@/components/form-error";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/action-result";
import { SaveStatus } from "./save-status";

type Initial = { name: string; active: boolean; serviceIds: string[] };

export function StaffForm({
  action,
  services,
  initial = { name: "", active: true, serviceIds: [] },
  submitLabel,
  showActive = true,
}: {
  action: (prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;
  services: { id: string; name: string }[];
  initial?: Initial;
  submitLabel: string;
  showActive?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const [v, setV] = useState(initial);
  const errors = state && !state.ok ? state.fieldErrors : undefined;

  return (
    <form action={formAction} className="grid max-w-xl gap-4">
      {state && !state.ok && !state.fieldErrors && <FormError message={state.error} />}
      <FormField label="Name" name="name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} errors={errors?.name} required />
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">Services they perform</legend>
        {services.length === 0 && <p className="text-sm text-muted-foreground">No services yet.</p>}
        {services.map((s) => (
          <label key={s.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="serviceIds"
              value={s.id}
              checked={v.serviceIds.includes(s.id)}
              onChange={(e) =>
                setV({ ...v, serviceIds: e.target.checked ? [...v.serviceIds, s.id] : v.serviceIds.filter((id) => id !== s.id) })
              }
            />
            {s.name}
          </label>
        ))}
      </fieldset>
      {showActive ? (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="active" checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} />
          Active (can take bookings)
        </label>
      ) : (
        <input type="hidden" name="active" value="on" />
      )}
      <div className="flex items-center gap-4">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </Button>
        <SaveStatus state={state && state.ok ? state : null} />
      </div>
    </form>
  );
}
