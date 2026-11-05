import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

// Calendar dates as "YYYY-MM-DD" strings. A calendar date has no timezone: "2031-03-09" is the
// same day everywhere. Only turning a date + a wall-clock time INTO an instant needs a timezone.

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidDateString(value: string): boolean {
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(Date.UTC(y, mo - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === mo - 1 && probe.getUTCDate() === d;
}

function toUtcDate(value: string): Date {
  const m = DATE_RE.exec(value)!;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function fromUtcDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** "2031-03-09" + 1 -> "2031-03-10" (pure calendar arithmetic; DST cannot affect it). */
export function addDaysToDate(value: string, days: number): string {
  const d = toUtcDate(value);
  d.setUTCDate(d.getUTCDate() + days);
  return fromUtcDate(d);
}

/** 0 = Sunday ... 6 = Saturday, matching AvailabilityRule.dayOfWeek. */
export function dayOfWeekOf(value: string): number {
  return toUtcDate(value).getUTCDay();
}

/** Today's calendar date in a timezone, e.g. at 23:30 UTC it is already tomorrow in Auckland. */
export function todayIn(timeZone: string, now: Date): string {
  return formatInTimeZone(now, timeZone, "yyyy-MM-dd");
}

/**
 * The UTC instant of "<date> at <minutes after local midnight>" in a timezone. 1440 means the
 * start of the next day (a rule that runs to midnight). DST-safe: the zone's rules pick the offset.
 */
export function localInstant(date: string, minutes: number, timeZone: string): Date {
  const day = minutes >= 1440 ? addDaysToDate(date, 1) : date;
  const m = minutes >= 1440 ? minutes - 1440 : minutes;
  const hh = String(Math.floor(m / 60)).padStart(2, "0");
  const mm = String(m % 60).padStart(2, "0");
  return fromZonedTime(`${day}T${hh}:${mm}:00`, timeZone);
}

/** Calendar date of an instant in a timezone. */
export function dateOfInstant(instant: Date, timeZone: string): string {
  return formatInTimeZone(instant, timeZone, "yyyy-MM-dd");
}

/** Mon 10 Nov style label for a calendar date (no timezone involved). */
export function formatDateLabel(value: string): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(
    toUtcDate(value),
  );
}
