import { z } from "zod";
import { shillingsField, wholeShillingCents as cents } from "./fields";

const name = z.string().trim().min(1, "Name the service").max(80);
const description = z.string().trim().max(500).nullable();
const durationMin = z.number().int().min(5).max(480).multipleOf(5, "Use 5-minute steps");
const ids = z.array(z.string().min(1)).max(100);

// Money is integer cents of KES everywhere past this file, and always whole shillings (M-Pesa can't
// collect fractions). The deposit <= price rule is checked in the service against merged values (a
// patch may change only one), with DB CHECKs as a backstop.

/** Create (API and form share this shape after the form's shillings are converted to cents). */
export const createServiceInput = z.object({
  name,
  description: description.default(null),
  durationMin,
  priceCents: cents,
  depositCents: cents,
  active: z.boolean().default(true),
  staffIds: ids.default([]),
});

/** Partial update (PATCH). `staffIds`, when present, replaces who offers the service. */
export const updateServiceInput = z
  .object({ name, description, durationMin, priceCents: cents, depositCents: cents, active: z.boolean(), staffIds: ids })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");

/** The HTML form: shillings as text, checkbox for active, repeated staffIds fields. */
export const serviceFormInput = z
  .object({
    name,
    description: z.string().trim().max(500).transform((v) => (v === "" ? null : v)),
    durationMin: z.coerce.number().int().min(5).max(480).multipleOf(5, "Use 5-minute steps"),
    price: shillingsField,
    deposit: shillingsField,
    active: z.boolean(),
    staffIds: ids,
  })
  .transform(({ price, deposit, ...rest }) => ({ ...rest, priceCents: price, depositCents: deposit }));

export type CreateServiceInput = z.infer<typeof createServiceInput>;
export type UpdateServiceInput = z.infer<typeof updateServiceInput>;
