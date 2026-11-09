import { z } from "zod";
import { MIN_DEPOSIT_CENTS } from "@/lib/constants/business";
import { moneyField } from "./fields";

const name = z.string().trim().min(1, "Name the service").max(80);
const description = z.string().trim().max(500).nullable();
const durationMin = z.number().int().min(5).max(480).multipleOf(5, "Use 5-minute steps");
const cents = z.number().int().min(0).max(1_000_000);
// Stripe can't charge less than USD 0.50, so a deposit is either free or at least that much.
const deposit = cents.refine((v) => v === 0 || v >= MIN_DEPOSIT_CENTS, `A deposit must be $0 or at least ${(MIN_DEPOSIT_CENTS / 100).toFixed(2)}`);
const ids = z.array(z.string().min(1)).max(100);

// Money is integer cents everywhere past this file. The deposit <= price rule is checked in the
// service against merged values (a patch may change only one), with a DB CHECK as a backstop.

/** Create (API and form share this shape after the form's dollars are converted to cents). */
export const createServiceInput = z.object({
  name,
  description: description.default(null),
  durationMin,
  priceCents: cents,
  depositCents: deposit,
  active: z.boolean().default(true),
  staffIds: ids.default([]),
});

/** Partial update (PATCH). `staffIds`, when present, replaces who offers the service. */
export const updateServiceInput = z
  .object({ name, description, durationMin, priceCents: cents, depositCents: deposit, active: z.boolean(), staffIds: ids })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");

/** The HTML form: dollars as text, checkbox for active, repeated staffIds fields. */
export const serviceFormInput = z
  .object({
    name,
    description: z.string().trim().max(500).transform((v) => (v === "" ? null : v)),
    durationMin: z.coerce.number().int().min(5).max(480).multipleOf(5, "Use 5-minute steps"),
    price: moneyField,
    deposit: moneyField,
    active: z.boolean(),
    staffIds: ids,
  })
  .transform(({ price, deposit: dep, ...rest }) => ({ ...rest, priceCents: price, depositCents: dep }))
  .refine((v) => v.depositCents === 0 || v.depositCents >= MIN_DEPOSIT_CENTS, {
    path: ["deposit"],
    message: `A deposit must be $0 or at least ${(MIN_DEPOSIT_CENTS / 100).toFixed(2)}`,
  });

export type CreateServiceInput = z.infer<typeof createServiceInput>;
export type UpdateServiceInput = z.infer<typeof updateServiceInput>;
