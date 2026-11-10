import { z } from "zod";
import { MPESA } from "@/lib/constants/business";
import { parseMoneyToCents } from "@/lib/money";
import { normalizeKenyanPhone } from "@/lib/phone";
import { hhmmToMinutes } from "@/lib/time";

// Field-level transforms shared by form validators: text from an <input> -> the stored form.

/** "1500" or "KSh 1,500" -> integer cents. */
export const moneyField = z.string().transform((v, ctx) => {
  const cents = parseMoneyToCents(v);
  if (cents === null) {
    ctx.addIssue({ code: "custom", message: "Enter an amount like 1500" });
    return z.NEVER;
  }
  return cents;
});

/**
 * Integer cents that are a whole number of shillings and within M-Pesa's per-payment limit. This ONE
 * rule is used for service prices, deposits and the onboarding wizard.
 */
export const wholeShillingCents = z
  .number()
  .int()
  .min(0)
  .max(MPESA.maxAmountCents, "That's above M-Pesa's KES 150,000 limit per payment")
  .multipleOf(100, "Use whole shillings (no cents)");

/** Shillings typed into a form ("1500", "KSh 1,500") -> validated cents. */
export const shillingsField = moneyField.pipe(wholeShillingCents);

/** "09:30" -> minutes after midnight. */
export const timeField = z.string().transform((v, ctx) => {
  const minutes = hhmmToMinutes(v);
  if (minutes === null) {
    ctx.addIssue({ code: "custom", message: "Use HH:MM" });
    return z.NEVER;
  }
  return minutes;
});

/** A Kenyan mobile number in any common format -> "2547XXXXXXXX". */
export const kenyanPhoneField = z.string().transform((v, ctx) => {
  const normalized = normalizeKenyanPhone(v);
  if (!normalized) {
    ctx.addIssue({ code: "custom", message: "Enter a Kenyan mobile number like 0712 345 678" });
    return z.NEVER;
  }
  return normalized;
});
