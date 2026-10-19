import { z } from "zod";

const name = z.string().trim().min(1, "Enter a name").max(80);
const ids = z.array(z.string().min(1)).max(100);

export const createStaffInput = z.object({
  name,
  serviceIds: ids.default([]),
});

/** Partial update. `serviceIds`, when present, replaces the services this person performs. */
export const updateStaffInput = z
  .object({ name, active: z.boolean(), serviceIds: ids })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");

/** The HTML form for a staff member's profile. */
export const staffFormInput = z.object({ name, active: z.boolean(), serviceIds: ids });

export type CreateStaffInput = z.infer<typeof createStaffInput>;
export type UpdateStaffInput = z.infer<typeof updateStaffInput>;
