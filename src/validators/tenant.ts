import { z } from "zod";
import { RESERVED_SLUGS } from "@/lib/constants/reserved-slugs";
import { isValidTimeZone } from "@/lib/time";
import { moneyField as money, timeField as time } from "./fields";

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "Use at least 3 characters")
  .max(40, "Use at most 40 characters")
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Letters, numbers and single hyphens only")
  .refine((s) => !RESERVED_SLUGS.has(s), "That name is reserved");

export const timezoneSchema = z.string().refine(isValidTimeZone, "Choose a valid timezone");


export const firstServiceInput = z
  .object({
    name: z.string().trim().min(1, "Name the service").max(80),
    durationMin: z.coerce.number().int().min(5).max(480).multipleOf(5, "Use 5-minute steps"),
    price: money,
    deposit: money,
  })
  .refine((s) => s.deposit <= s.price, { path: ["deposit"], message: "Deposit can't exceed the price" });

// One open interval per working day (split shifts can be added later in availability).
export const weeklyHoursInput = z
  .array(
    z
      .object({ dayOfWeek: z.number().int().min(0).max(6), start: time, end: time })
      .refine((d) => d.end > d.start, { path: ["end"], message: "Closing must be after opening" }),
  )
  .min(1, "Open at least one day")
  .refine((days) => new Set(days.map((d) => d.dayOfWeek)).size === days.length, "Duplicate day");

export const onboardingInput = z.object({
  shopName: z.string().trim().min(2, "Enter your shop name").max(80),
  slug: slugSchema,
  timezone: timezoneSchema,
  service: firstServiceInput,
  hours: weeklyHoursInput,
});

export type OnboardingInput = z.infer<typeof onboardingInput>;
