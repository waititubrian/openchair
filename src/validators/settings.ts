import { z } from "zod";
import { timezoneSchema } from "./tenant";

export const updateSettingsInput = z
  .object({ name: z.string().trim().min(2).max(80), timezone: timezoneSchema })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");

export type UpdateSettingsInput = z.infer<typeof updateSettingsInput>;
