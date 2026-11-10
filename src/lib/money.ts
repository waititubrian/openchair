// All money is integer cents of KES (100 cents = KES 1) and always a whole number of shillings.
// These are the only places cents <-> display conversion happens.

/**
 * 250000 -> "KSh 2,500" (whole shillings drop the decimals; anything else keeps two).
 * Shillings are formatted by hand: Intl's symbol for KES ("Ksh" vs "KSh" vs "KES") differs between
 * ICU versions, and server and browser must render identical text.
 */
export function formatMoney(cents: number, currency = "kes"): string {
  const whole = cents % 100 === 0;
  const digits = new Intl.NumberFormat("en-US", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 }).format(cents / 100);
  if (currency.toLowerCase() === "kes") return `KSh ${digits}`;
  return `${currency.toUpperCase()} ${digits}`;
}

/** "1500", "1,500", "KSh 1500", "KES 1,500.50" -> cents. Returns null if it isn't a valid non-negative amount. */
export function parseMoneyToCents(input: string): number | null {
  const cleaned = input
    .trim()
    .replace(/^(ksh\.?|kes|\$)\s*/i, "")
    .replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, frac = ""] = cleaned.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

/** 150000 -> "1500" (for filling a price input). Whole shillings have no decimals. */
export function centsToInput(cents: number): string {
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}

/** True when the amount is a whole number of shillings. */
export const isWholeShillings = (cents: number) => cents % 100 === 0;
