import { dayOfWeekOf, localInstant } from "@/lib/dates";

// The slot engine: pure functions, no database, no clock of its own. Everything it needs is
// passed in, so every rule can be unit-tested with fixed inputs (including DST days).
//
//   open windows (weekly rules, in the shop's wall-clock time)
//     - busy intervals (time off, confirmed bookings, UNEXPIRED holds)
//     - slots that are too soon / too far ahead
//     = the start times a customer may pick

export type Interval = { start: Date; end: Date };
export type WeeklyRule = { dayOfWeek: number; startMinute: number; endMinute: number };

export type StaffAvailability = {
  staffId: string;
  rules: WeeklyRule[];
  /** Everything that blocks this person: time off plus live bookings. Half-open [start, end). */
  busy: Interval[];
};

export type Slot = {
  startsAt: Date;
  /** Staff members free at this start time (more than one when offering "any available"). */
  staffIds: string[];
};

export type SlotQuery = {
  /** Calendar date in the shop's timezone, "YYYY-MM-DD". */
  date: string;
  timezone: string;
  durationMin: number;
  /** Spacing between offered start times, anchored at the start of each open window. */
  intervalMin: number;
  now: Date;
  minNoticeMin: number;
  maxAdvanceDays: number;
  staff: StaffAvailability[];
};

const MIN = 60_000;

/** Half-open overlap: 10:00-10:30 and 10:30-11:00 do NOT overlap. */
export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && a.end > b.start;
}

/** Start times one person could be booked for on one date (each start fits the whole duration). */
export function slotStartsForStaff(q: Omit<SlotQuery, "staff">, person: StaffAvailability): Date[] {
  const earliest = q.now.getTime() + q.minNoticeMin * MIN;
  const latest = q.now.getTime() + q.maxAdvanceDays * 24 * 60 * MIN;
  const dow = dayOfWeekOf(q.date);
  const seen = new Set<number>();
  const starts: Date[] = [];

  for (const rule of person.rules) {
    if (rule.dayOfWeek !== dow) continue;
    // Wall-clock endpoints -> instants. On a DST day the window is 1 hour shorter/longer than
    // the clock difference, and that is the correct "shop open 9am to 5pm" meaning.
    const windowStart = localInstant(q.date, rule.startMinute, q.timezone).getTime();
    const windowEnd = localInstant(q.date, rule.endMinute, q.timezone).getTime();

    for (let t = windowStart; t + q.durationMin * MIN <= windowEnd; t += q.intervalMin * MIN) {
      if (t < earliest || t > latest || seen.has(t)) continue;
      const candidate: Interval = { start: new Date(t), end: new Date(t + q.durationMin * MIN) };
      if (person.busy.some((b) => overlaps(candidate, b))) continue;
      seen.add(t);
      starts.push(candidate.start);
    }
  }
  return starts;
}

/** All bookable slots on a date, merged across the given staff (sorted by time). */
export function generateSlots(q: SlotQuery): Slot[] {
  const byTime = new Map<number, string[]>();
  for (const person of q.staff) {
    for (const start of slotStartsForStaff(q, person)) {
      const key = start.getTime();
      byTime.set(key, [...(byTime.get(key) ?? []), person.staffId]);
    }
  }
  return [...byTime.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([ms, staffIds]) => ({ startsAt: new Date(ms), staffIds }));
}
