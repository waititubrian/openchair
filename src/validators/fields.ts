import { z } from "zod";
import { parseMoneyToCents } from "@/lib/money";
import { hhmmToMinutes } from "@/lib/time";

// Field-level transforms shared by form validators: text from an <input> -> the stored form.

/** "35" or "$35.50" -> integer cents. */
export const moneyField = z.string().transform((v, ctx) => {
  const cents = parseMoneyToCents(v);
  if (cents === null) {
    ctx.addIssue({ code: "custom", message: "Enter an amount like 35 or 35.50" });
    return z.NEVER;
  }
  return cents;
});

/** "09:30" -> minutes after midnight. */
export const timeField = z.string().transform((v, ctx) => {
  const minutes = hhmmToMinutes(v);
  if (minutes === null) {
    ctx.addIssue({ code: "custom", message: "Use HH:MM" });
    return z.NEVER;
  }
  return minutes;
});
