"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { FormError } from "@/components/form-error";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/action-result";

export function BookingForm({
  action,
  hidden,
  pickerHref,
  depositNow = false,
}: {
  action: (prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;
  /** tenantSlug, serviceId, staff, startsAt: carried as hidden fields. */
  hidden: Record<string, string>;
  /** Where to send the customer if the time they picked was just taken. */
  pickerHref: string;
  /** A deposit is paid by M-Pesa right after booking: the phone number is required. */
  depositNow?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const [v, setV] = useState({ name: "", email: "", phone: "" });
  const errors = state && !state.ok ? state.fieldErrors : undefined;
  const taken = state && !state.ok && state.code === "SLOT_UNAVAILABLE";

  return (
    <form action={formAction} className="grid gap-4">
      {Object.entries(hidden).map(([k, value]) => (
        <input key={k} type="hidden" name={k} value={value} />
      ))}
      {/* Honeypot: invisible to people, tempting to bots. Must stay empty. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Website
          <input type="text" name="website" tabIndex={-1} autoComplete="off" defaultValue="" />
        </label>
      </div>

      {state && !state.ok && !state.fieldErrors && (
        <div className="grid gap-2">
          <FormError message={state.error} />
          {taken && (
            <Link href={pickerHref} className="text-sm underline underline-offset-4">
              Choose another time
            </Link>
          )}
        </div>
      )}
      <FormField label="Your name" name="name" autoComplete="name" required value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} errors={errors?.name} />
      <FormField label="Email" name="email" type="email" autoComplete="email" required value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} errors={errors?.email} />
      <FormField
        label={depositNow ? "M-Pesa phone number" : "Phone (optional)"}
        name="phone"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        placeholder="0712 345 678"
        required={depositNow}
        value={v.phone}
        onChange={(e) => setV({ ...v, phone: e.target.value })}
        errors={errors?.phone}
      />
      {depositNow && <p className="-mt-2 text-xs text-muted-foreground">We&apos;ll send an M-Pesa prompt to this number for the deposit.</p>}
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "Booking…" : depositNow ? "Book and pay deposit" : "Confirm booking"}
      </Button>
    </form>
  );
}
