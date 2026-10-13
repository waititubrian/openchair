import { z } from "zod";

// Partial update of a service (API / owner dashboard). Money is integer cents.
// The cross-field rule "deposit <= price" is checked in the service against the merged
// values (a patch may change only one of them), with a DB CHECK constraint as a backstop.
export const updateServiceInput = z
  .object({
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().max(500).nullable(),
    durationMin: z.number().int().min(5).max(480).multipleOf(5),
    priceCents: z.number().int().min(0).max(1_000_000),
    depositCents: z.number().int().min(0).max(1_000_000),
    active: z.boolean(),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");

export type UpdateServiceInput = z.infer<typeof updateServiceInput>;
