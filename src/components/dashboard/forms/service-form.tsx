"use client";

import { useActionState, useId, useState } from "react";
import { FormError } from "@/components/form-error";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { ActionResult } from "@/lib/action-result";
import { SaveStatus } from "./save-status";

type Initial = {
  name: string;
  description: string;
  durationMin: string;
  price: string;
  deposit: string;
  active: boolean;
  staffIds: string[];
};

const EMPTY: Initial = { name: "", description: "", durationMin: "30", price: "", deposit: "", active: true, staffIds: [] };

export function ServiceForm({
  action,
  staff,
  initial = EMPTY,
  submitLabel,
}: {
  action: (prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;
  staff: { id: string; name: string }[];
  initial?: Initial;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const descriptionId = useId();
  const [v, setV] = useState(initial);
  const errors = state && !state.ok ? state.fieldErrors : undefined;
  const set = <K extends keyof Initial>(k: K, value: Initial[K]) => setV((p) => ({ ...p, [k]: value }));

  return (
    <form action={formAction} className="grid max-w-xl gap-4">
      {state && !state.ok && !state.fieldErrors && <FormError message={state.error} />}
      <FormField label="Name" name="name" value={v.name} onChange={(e) => set("name", e.target.value)} errors={errors?.name} required />
      <div className="grid gap-1.5">
        <Label htmlFor={descriptionId}>Description (optional)</Label>
        <textarea
          id={descriptionId}
          name="description"
          rows={2}
          value={v.description}
          onChange={(e) => set("description", e.target.value)}
          className="rounded-md border border-input bg-transparent px-3 py-2 text-sm"
        />
        {errors?.description && <p className="text-sm text-red-600 dark:text-red-400">{errors.description[0]}</p>}
      </div>
      <div className="grid grid-cols-3 gap-3">
        <FormField
          label="Minutes"
          name="durationMin"
          inputMode="numeric"
          value={v.durationMin}
          onChange={(e) => set("durationMin", e.target.value)}
          errors={errors?.durationMin}
        />
        <FormField label="Price ($)" name="price" inputMode="decimal" value={v.price} onChange={(e) => set("price", e.target.value)} errors={errors?.price} />
        <FormField label="Deposit ($)" name="deposit" inputMode="decimal" value={v.deposit} onChange={(e) => set("deposit", e.target.value)} errors={errors?.deposit} />
      </div>
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">Offered by</legend>
        {staff.length === 0 && <p className="text-sm text-muted-foreground">No staff yet. Add a staff member first.</p>}
        {staff.map((s) => (
          <label key={s.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="staffIds"
              value={s.id}
              checked={v.staffIds.includes(s.id)}
              onChange={(e) => set("staffIds", e.target.checked ? [...v.staffIds, s.id] : v.staffIds.filter((id) => id !== s.id))}
            />
            {s.name}
          </label>
        ))}
      </fieldset>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="active" checked={v.active} onChange={(e) => set("active", e.target.checked)} />
        Active (customers can book it)
      </label>
      <div className="flex items-center gap-4">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </Button>
        <SaveStatus state={state && state.ok ? state : null} />
      </div>
    </form>
  );
}
