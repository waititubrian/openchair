import { formatInTimeZone } from "date-fns-tz";

// Time helpers. Availability is stored as local wall-clock minutes after midnight.
// Conversion of a local date+time in a tenant timezone to a UTC instant happens in
// the slot service with date-fns-tz (Phase 4); these helpers only handle the HH:MM form.

export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

/** "09:30" -> 570. Returns null for anything that isn't a valid 00:00-24:00 time. */
export function hhmmToMinutes(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (min > 59 || h > 24 || (h === 24 && min !== 0)) return null;
  return h * 60 + min;
}

/** 570 -> "09:30" */
export function minutesToHhmm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function listTimeZones(): string[] {
  return Intl.supportedValuesOf("timeZone");
}

/** Format a UTC instant in a tenant's timezone, e.g. formatInZone(d, "America/New_York", "EEE d MMM, h:mm a"). */
export function formatInZone(date: Date, timeZone: string, pattern = "EEE d MMM yyyy, h:mm a"): string {
  return formatInTimeZone(date, timeZone, pattern);
}
