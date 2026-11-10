import { z } from "zod";
import { isValidDateString } from "@/lib/dates";
import { kenyanPhoneField } from "./fields";

/** "any" = whoever is free; otherwise a staff member's id. */
const staffChoice = z.union([z.literal("any"), z.string().min(1).max(40)]).default("any");

/** Optional on the form; the service requires it when a deposit must be paid by M-Pesa. */
const phone = z
  .string()
  .trim()
  .max(20)
  .transform((v) => (v === "" ? undefined : v))
  .pipe(kenyanPhoneField.optional())
  .optional();

/** What the public details form submits. Booking time is an ISO instant picked from the slot list. */
export const createPublicBookingInput = z.object({
  tenantSlug: z.string().min(1).max(60),
  serviceId: z.string().min(1).max(40),
  staff: staffChoice,
  startsAt: z.iso.datetime({ message: "Pick a time" }),
  name: z.string().trim().min(1, "Enter your name").max(80),
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address")),
  phone,
  /** Honeypot: hidden from people, filled by bots. Must stay empty. */
  website: z.string().max(0).optional().default(""),
});

/** The slot picker's URL: which week is shown, which day is selected, who with. */
export const slotPickerQuery = z.object({
  staff: staffChoice,
  from: z.string().refine(isValidDateString).optional().catch(undefined),
  date: z.string().refine(isValidDateString).optional().catch(undefined),
});

/** Marks a booking completed or no-show (after it started) or cancelled. */
export const bookingStatusInput = z.object({ status: z.enum(["CANCELLED", "COMPLETED", "NO_SHOW"]) });

export type CreatePublicBookingInput = z.infer<typeof createPublicBookingInput>;
export type BookingStatusInput = z.infer<typeof bookingStatusInput>;
