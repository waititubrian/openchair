import { z } from "zod";

export const updateStaffInput = z
  .object({ name: z.string().trim().min(1).max(80), active: z.boolean() })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");

export type UpdateStaffInput = z.infer<typeof updateStaffInput>;
