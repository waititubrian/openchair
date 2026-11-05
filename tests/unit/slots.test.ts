import { describe, expect, it } from "vitest";
import { addDaysToDate, dateOfInstant, dayOfWeekOf, formatDateLabel, isValidDateString, localInstant, todayIn } from "@/lib/dates";
import { generateSlots, overlaps, type SlotQuery, type StaffAvailability } from "@/lib/slots";

const NY = "America/New_York";
const iso = (d: Date) => d.toISOString();
const at = (s: string) => new Date(s);

// 2031-07-01 is a Tuesday (dayOfWeek 2). New York is on EDT (UTC-4): 09:00 local = 13:00Z.
const TUESDAY = "2031-07-01";
const longBefore = at("2031-06-01T00:00:00Z");

const tuesdayStaff = (over: Partial<StaffAvailability> = {}): StaffAvailability => ({
  staffId: "A",
  rules: [{ dayOfWeek: 2, startMinute: 540, endMinute: 1020 }], // 09:00-17:00
  busy: [],
  ...over,
});

const query = (over: Partial<SlotQuery> = {}): SlotQuery => ({
  date: TUESDAY,
  timezone: NY,
  durationMin: 30,
  intervalMin: 30,
  now: longBefore,
  minNoticeMin: 0,
  maxAdvanceDays: 365,
  staff: [tuesdayStaff()],
  ...over,
});

const starts = (q: SlotQuery) => generateSlots(q).map((s) => iso(s.startsAt));

describe("slot grid", () => {
  it("offers every start in the open window that fits the service", () => {
    const s = starts(query());
    expect(s).toHaveLength(16); // 09:00 .. 16:30 every 30 min
    expect(s[0]).toBe("2031-07-01T13:00:00.000Z"); // 09:00 EDT
    expect(s.at(-1)).toBe("2031-07-01T20:30:00.000Z"); // 16:30 EDT, ends exactly at closing
  });

  it("a longer service can't start so late that it would run past closing", () => {
    const s = starts(query({ durationMin: 60 }));
    expect(s.at(-1)).toBe("2031-07-01T20:00:00.000Z"); // 16:00 start ends 17:00
    expect(s).toHaveLength(15);
  });

  it("respects the interval, which may be smaller than the duration", () => {
    expect(starts(query({ intervalMin: 15 }))).toHaveLength(31);
  });

  it("offers nothing on a day the person doesn't work", () => {
    expect(starts(query({ date: "2031-07-02" }))).toEqual([]); // Wednesday
  });

  it("supports split shifts (a gap between two windows)", () => {
    const s = starts(
      query({
        staff: [tuesdayStaff({ rules: [{ dayOfWeek: 2, startMinute: 540, endMinute: 720 }, { dayOfWeek: 2, startMinute: 780, endMinute: 1020 }] })],
      }),
    );
    expect(s).not.toContain("2031-07-01T16:00:00.000Z"); // 12:00 local, lunch
    expect(s).not.toContain("2031-07-01T16:30:00.000Z");
    expect(s).toContain("2031-07-01T15:30:00.000Z"); // 11:30 ends at 12:00
    expect(s).toContain("2031-07-01T17:00:00.000Z"); // 13:00 reopens
  });

  it("does not repeat a start when rules overlap", () => {
    const s = starts(
      query({ staff: [tuesdayStaff({ rules: [{ dayOfWeek: 2, startMinute: 540, endMinute: 720 }, { dayOfWeek: 2, startMinute: 600, endMinute: 780 }] })] }),
    );
    expect(new Set(s).size).toBe(s.length);
  });

  it("a window that runs to midnight (1440) includes the last half hour", () => {
    const s = starts(query({ staff: [tuesdayStaff({ rules: [{ dayOfWeek: 2, startMinute: 1320, endMinute: 1440 }] })] }));
    expect(s).toHaveLength(4); // 22:00, 22:30, 23:00, 23:30
    expect(s.at(-1)).toBe("2031-07-02T03:30:00.000Z"); // 23:30 EDT
  });
});

describe("busy time (bookings, held slots, time off)", () => {
  const booking = { start: at("2031-07-01T14:00:00Z"), end: at("2031-07-01T14:30:00Z") }; // 10:00-10:30 local

  it("removes the booked slot but keeps the touching ones (half-open intervals)", () => {
    const s = starts(query({ staff: [tuesdayStaff({ busy: [booking] })] }));
    expect(s).not.toContain("2031-07-01T14:00:00.000Z");
    expect(s).toContain("2031-07-01T13:30:00.000Z"); // 09:30-10:00 touches the booking, doesn't overlap
    expect(s).toContain("2031-07-01T14:30:00.000Z"); // 10:30-11:00 starts when the booking ends
  });

  it("a longer service loses every start whose span would overlap", () => {
    const s = starts(query({ durationMin: 60, staff: [tuesdayStaff({ busy: [booking] })] }));
    expect(s).not.toContain("2031-07-01T13:30:00.000Z"); // 09:30-10:30 overlaps
    expect(s).not.toContain("2031-07-01T14:00:00.000Z");
    expect(s).toContain("2031-07-01T13:00:00.000Z"); // 09:00-10:00 just fits
    expect(s).toContain("2031-07-01T14:30:00.000Z");
  });

  it("all-day time off leaves nothing", () => {
    const timeOff = { start: at("2031-07-01T00:00:00Z"), end: at("2031-07-02T00:00:00Z") };
    expect(starts(query({ staff: [tuesdayStaff({ busy: [timeOff] })] }))).toEqual([]);
  });

  it("overlaps() is half-open", () => {
    const a = { start: at("2031-01-01T10:00:00Z"), end: at("2031-01-01T10:30:00Z") };
    expect(overlaps(a, { start: at("2031-01-01T10:30:00Z"), end: at("2031-01-01T11:00:00Z") })).toBe(false);
    expect(overlaps(a, { start: at("2031-01-01T10:29:00Z"), end: at("2031-01-01T11:00:00Z") })).toBe(true);
  });
});

describe("notice and booking horizon", () => {
  it("hides starts closer than the minimum notice, keeps the boundary itself", () => {
    // now = 09:00 local; 60 min notice => earliest 10:00 local = 14:00Z (inclusive)
    const s = starts(query({ now: at("2031-07-01T13:00:00Z"), minNoticeMin: 60 }));
    expect(s[0]).toBe("2031-07-01T14:00:00.000Z");
  });

  it("offers nothing for a day that has already passed", () => {
    expect(starts(query({ now: at("2031-07-02T00:00:00Z") }))).toEqual([]);
  });

  it("hides starts beyond the booking horizon", () => {
    expect(starts(query({ now: at("2031-06-30T00:00:00Z"), maxAdvanceDays: 1 }))).toEqual([]); // 07-01T13:00Z is > 1 day away
    expect(starts(query({ now: at("2031-06-30T00:00:00Z"), maxAdvanceDays: 2 }))).toHaveLength(16);
  });
});

describe("daylight saving and timezones", () => {
  const allDay = { dayOfWeek: 0, startMinute: 0, endMinute: 1440 };
  const beforeMarch = at("2031-01-01T00:00:00Z"); // "now" must precede the dates under test or they are in the past

  it("spring-forward day (2031-03-09) has 23 hourly slots", () => {
    const s = starts(query({ date: "2031-03-09", now: beforeMarch, durationMin: 60, intervalMin: 60, staff: [tuesdayStaff({ rules: [allDay] })] }));
    expect(s).toHaveLength(23);
    expect(s[0]).toBe("2031-03-09T05:00:00.000Z"); // 00:00 EST
    expect(s.at(-1)).toBe("2031-03-10T03:00:00.000Z"); // 23:00 EDT
  });

  it("fall-back day (2031-11-02) has 25 hourly slots", () => {
    const s = starts(query({ date: "2031-11-02", durationMin: 60, intervalMin: 60, staff: [tuesdayStaff({ rules: [allDay] })] }));
    expect(s).toHaveLength(25);
    expect(s[0]).toBe("2031-11-02T04:00:00.000Z"); // 00:00 EDT
    expect(s.at(-1)).toBe("2031-11-03T04:00:00.000Z"); // 23:00 EST
  });

  it("'9am' stays 9am local across the change: UTC moves by an hour", () => {
    const nineAm = (date: string, dow: number) =>
      starts(query({ date, now: beforeMarch, staff: [tuesdayStaff({ rules: [{ dayOfWeek: dow, startMinute: 540, endMinute: 1020 }] })] }))[0];
    expect(nineAm("2031-03-08", 6)).toBe("2031-03-08T14:00:00.000Z"); // Saturday, EST
    expect(nineAm("2031-03-09", 0)).toBe("2031-03-09T13:00:00.000Z"); // Sunday, EDT
  });

  it("uses the SHOP's calendar day, not UTC's (Auckland is UTC+12 in July)", () => {
    const s = starts(query({ timezone: "Pacific/Auckland" }));
    expect(s[0]).toBe("2031-06-30T21:00:00.000Z"); // 09:00 on 07-01 local is still 06-30 in UTC
    expect(dateOfInstant(at(s[0]), "Pacific/Auckland")).toBe("2031-07-01");
  });
});

describe("any available person", () => {
  it("merges staff and says who is free at each time", () => {
    const a = tuesdayStaff({ staffId: "A" });
    const b = tuesdayStaff({ staffId: "B", busy: [{ start: at("2031-07-01T13:00:00Z"), end: at("2031-07-01T16:00:00Z") }] }); // B busy 09:00-12:00
    const slots = generateSlots(query({ staff: [a, b] }));
    expect(slots[0].staffIds).toEqual(["A"]); // 09:00: only A
    const noon = slots.find((s) => iso(s.startsAt) === "2031-07-01T16:00:00.000Z");
    expect(noon?.staffIds).toEqual(["A", "B"]);
    expect(slots.map((s) => s.startsAt.getTime())).toEqual([...slots.map((s) => s.startsAt.getTime())].sort((x, y) => x - y));
  });

  it("is empty when nobody works that day", () => {
    expect(generateSlots(query({ staff: [] }))).toEqual([]);
  });
});

describe("calendar date helpers", () => {
  it("validates real dates only", () => {
    expect(isValidDateString("2032-02-29")).toBe(true);
    expect(isValidDateString("2031-02-29")).toBe(false);
    expect(isValidDateString("2031-13-01")).toBe(false);
    expect(isValidDateString("2031-7-1")).toBe(false);
    expect(isValidDateString("not a date")).toBe(false);
  });
  it("adds days across months, years and leap days", () => {
    expect(addDaysToDate("2031-12-31", 1)).toBe("2032-01-01");
    expect(addDaysToDate("2032-02-28", 1)).toBe("2032-02-29");
    expect(addDaysToDate("2031-03-01", -1)).toBe("2031-02-28");
    expect(addDaysToDate("2031-03-08", 1)).toBe("2031-03-09"); // DST never affects calendar arithmetic
  });
  it("knows the weekday", () => {
    expect(dayOfWeekOf("2031-07-01")).toBe(2);
    expect(dayOfWeekOf("2031-03-09")).toBe(0);
  });
  it("today depends on the timezone", () => {
    const now = at("2031-07-01T23:30:00Z");
    expect(todayIn("Pacific/Auckland", now)).toBe("2031-07-02");
    expect(todayIn("America/Los_Angeles", now)).toBe("2031-07-01");
  });
  it("localInstant treats 1440 as the start of the next day", () => {
    expect(iso(localInstant("2031-07-01", 1440, NY))).toBe("2031-07-02T04:00:00.000Z");
    expect(iso(localInstant("2031-07-01", 0, NY))).toBe("2031-07-01T04:00:00.000Z");
  });
  it("labels a date without timezone drift", () => {
    expect(formatDateLabel("2031-07-01")).toBe("Tue, Jul 1");
  });
});
