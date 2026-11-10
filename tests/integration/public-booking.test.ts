import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Deposit bookings need M-Pesa to be configured; createBooking itself never calls Safaricom.
vi.mock("@/lib/mpesa", () => ({ isMpesaConfigured: () => true, getMpesa: async () => { throw new Error("not used here"); }, mpesaCallbackUrl: () => "http://localhost:3000/cb" }));
import { ConflictError, NotFoundError, RateLimitError, SlotUnavailableError, ValidationError } from "@/lib/errors";
import type { TenantContext } from "@/lib/tenant-context";
import * as bookingService from "@/services/booking.service";
import * as publicBooking from "@/services/public-booking.service";
import { createTestPrisma } from "../support/db.mts";
import { cleanupRun, ctxFor, openWholeWeek, seedShop, type ShopFixture } from "../support/fixtures.mts";

// The public booking flow against the REAL database, including races. Time is controlled by
// passing `now`, so every date below is deterministic.
const prisma = createTestPrisma();
const run = Math.random().toString(36).slice(2, 8);
const NOW = new Date("2031-07-01T12:00:00Z"); // Tuesday 08:00 in New York (EDT, UTC-4)
const WED_10AM = "2031-07-02T14:00:00.000Z"; // Wednesday 10:00 EDT
const WED = "2031-07-02";

let S: ShopFixture; // the shop under test
let O: ShopFixture; // another shop
let ownerCtx: TenantContext;
let staffCtx: TenantContext;
let keyN = 0;
const key = () => `k${run}-${keyN++}`; // each call gets its own client, so rate limiting never interferes

const user = (label: string) => prisma.user.create({ data: { email: `${label}-${run}@it.example.com`, name: label } });

function book(over: Partial<Parameters<typeof publicBooking.createBooking>[0]> = {}, opts: { now?: Date; clientKey?: string } = {}) {
  return publicBooking.createBooking(
    {
      tenantSlug: S.tenant.slug,
      serviceId: S.service.id,
      staff: "any",
      startsAt: WED_10AM,
      name: "Casey Customer",
      email: `cust-${key()}@it.example.com`,
      website: "",
      ...over,
    },
    { clientKey: opts.clientKey ?? key(), now: opts.now ?? NOW },
  );
}

const rows = (where: object = {}) => prisma.booking.findMany({ where: { tenantId: S.tenant.id, ...where }, orderBy: { startsAt: "asc" } });
const reset = async () => {
  await prisma.booking.deleteMany({ where: { tenantId: S.tenant.id } });
  await prisma.timeOff.deleteMany({ where: { tenantId: S.tenant.id } });
  await prisma.tenant.update({ where: { id: S.tenant.id }, data: { payoutPhone: null } });
  await prisma.service.update({ where: { id: S.service.id }, data: { active: true } });
};

beforeAll(async () => {
  S = await seedShop(prisma, run, "P", { owner: await user("p-owner"), staffUser: await user("p-staff") });
  O = await seedShop(prisma, run, "Q", { owner: await user("q-owner"), staffUser: await user("q-staff") });
  await openWholeWeek(prisma, S);
  await openWholeWeek(prisma, O);
  ownerCtx = await ctxFor(prisma, S, "owner");
  staffCtx = await ctxFor(prisma, S, "staff");
});
afterAll(async () => {
  await prisma.rateLimit.deleteMany({ where: { key: { startsWith: "pub:" } } });
  await cleanupRun(prisma, run);
  await prisma.$disconnect();
});

describe("what the public can see", () => {
  it("lists only bookable services, with public fields only", async () => {
    const inactive = await prisma.service.create({ data: { tenantId: S.tenant.id, name: "Hidden inactive", durationMin: 30, priceCents: 1000, depositCents: 0, active: false } });
    const nobody = await prisma.service.create({ data: { tenantId: S.tenant.id, name: "Hidden nobody", durationMin: 30, priceCents: 1000, depositCents: 0 } }); // no staff perform it
    const { shop, services } = await publicBooking.getShop(S.tenant.slug);
    expect(services.map((s) => s.id)).toEqual([S.service.id]);
    expect(shop).toEqual({ name: S.tenant.name, slug: S.tenant.slug, timezone: "America/New_York", currency: "kes", depositOnline: false });
    const json = JSON.stringify({ shop, services });
    for (const secret of [S.owner.email, S.owner.id, S.tenant.id, "payoutPhone"]) expect(json).not.toContain(secret);
    await prisma.service.deleteMany({ where: { id: { in: [inactive.id, nobody.id] } } });
  });

  it("unknown shop, inactive service, another shop's service and unknown staff are all NotFound", async () => {
    await expect(publicBooking.getShop("no-such-shop-" + run)).rejects.toBeInstanceOf(NotFoundError);
    await expect(publicBooking.getAvailability(S.tenant.slug, O.service.id, "any", undefined, NOW)).rejects.toBeInstanceOf(NotFoundError);
    await expect(publicBooking.getAvailability(S.tenant.slug, S.service.id, O.ownerStaff.id, undefined, NOW)).rejects.toBeInstanceOf(NotFoundError);
    await prisma.service.update({ where: { id: S.service.id }, data: { active: false } });
    await expect(publicBooking.getAvailability(S.tenant.slug, S.service.id, "any", undefined, NOW)).rejects.toBeInstanceOf(NotFoundError);
    await reset();
  });
});

describe("the time picker", () => {
  it("shows a week of slots in the shop's timezone", async () => {
    const a = await publicBooking.getAvailability(S.tenant.slug, S.service.id, "any", "2031-07-02", NOW);
    expect(a.days.map((d) => d.date)).toEqual(["2031-07-02", "2031-07-03", "2031-07-04", "2031-07-05", "2031-07-06", "2031-07-07", "2031-07-08"]);
    const wed = a.days[0].slots;
    expect(wed).toHaveLength(31); // 09:00 .. 16:30 every 15 minutes
    expect(wed[0]).toEqual({ startsAt: "2031-07-02T13:00:00.000Z", label: "9:00 AM" });
    expect(wed.at(-1)?.label).toBe("4:30 PM");
  });

  it("today only offers slots after the minimum notice, and 'from' in the past clamps to today", async () => {
    const a = await publicBooking.getAvailability(S.tenant.slug, S.service.id, "any", "2031-06-01", NOW);
    expect(a.from).toBe("2031-07-01");
    expect(a.prevFrom).toBeNull();
    expect(a.nextFrom).toBe("2031-07-08");
    expect(a.days[0].slots[0].label).toBe("9:00 AM"); // now is 08:00, notice 60 min => 09:00 is the first
    const later = await publicBooking.getAvailability(S.tenant.slug, S.service.id, "any", undefined, new Date("2031-07-01T14:10:00Z"));
    expect(later.days[0].slots[0].label).toBe("11:15 AM"); // 10:10 local + 60 min => next grid start is 11:15
  });

  it("stops at the booking horizon", async () => {
    const far = await publicBooking.getAvailability(S.tenant.slug, S.service.id, "any", "2032-01-01", NOW);
    expect(far.from).toBe("2031-07-01"); // beyond the 60-day horizon: clamped back to today
    const last = await publicBooking.getAvailability(S.tenant.slug, S.service.id, "any", "2031-08-26", NOW);
    expect(last.nextFrom).toBeNull();
  });

  it("a booking removes that slot for that person only; 'any' still offers it via the other person", async () => {
    await reset();
    await book({ staff: S.ownerStaff.id });
    const forOwner = await publicBooking.getAvailability(S.tenant.slug, S.service.id, S.ownerStaff.id, WED, NOW);
    expect(forOwner.days[0].slots.map((s) => s.startsAt)).not.toContain(WED_10AM);
    const forOther = await publicBooking.getAvailability(S.tenant.slug, S.service.id, S.staffUserStaff.id, WED, NOW);
    expect(forOther.days[0].slots.map((s) => s.startsAt)).toContain(WED_10AM);
    const any = await publicBooking.getAvailability(S.tenant.slug, S.service.id, "any", WED, NOW);
    expect(any.days[0].slots.map((s) => s.startsAt)).toContain(WED_10AM);
    await book({ staff: S.staffUserStaff.id }); // now both are taken
    const none = await publicBooking.getAvailability(S.tenant.slug, S.service.id, "any", WED, NOW);
    expect(none.days[0].slots.map((s) => s.startsAt)).not.toContain(WED_10AM);
    await reset();
  });

  it("time off hides slots", async () => {
    await prisma.timeOff.createMany({
      data: [S.ownerStaff.id, S.staffUserStaff.id].map((staffId) => ({ tenantId: S.tenant.id, staffId, startsAt: new Date("2031-07-03T04:00:00Z"), endsAt: new Date("2031-07-04T04:00:00Z") })),
    });
    const a = await publicBooking.getAvailability(S.tenant.slug, S.service.id, "any", WED, NOW);
    expect(a.days[1].date).toBe("2031-07-03");
    expect(a.days[1].slots).toEqual([]); // everyone is off all of Thursday
    expect(a.days[0].slots.length).toBeGreaterThan(0);
    await reset();
  });
});

describe("creating a booking", () => {
  it("creates a CONFIRMED booking (shop without card payments), snapshotting prices and upserting the customer", async () => {
    await reset();
    const r = await book({ phone: "+1 555 010 2030", name: "Jo Customer", email: `jo-${run}@it.example.com` });
    expect(r.status).toBe("CONFIRMED");
    expect(r.publicToken.length).toBeGreaterThan(10);
    const [b] = await rows();
    expect(b).toMatchObject({ status: "CONFIRMED", priceCents: 3000, depositCents: 500, holdExpiresAt: null, serviceId: S.service.id });
    expect(b.startsAt.toISOString()).toBe(WED_10AM);
    expect(b.endsAt.toISOString()).toBe("2031-07-02T14:30:00.000Z");
    const customer = await prisma.customer.findUniqueOrThrow({ where: { id: b.customerId } });
    expect(customer).toMatchObject({ name: "Jo Customer", email: `jo-${run}@it.example.com`, phone: "+1 555 010 2030" });
  });

  it("with a deposit due AND online deposits switched on (payout number set), the booking is PENDING_PAYMENT and holds the slot", async () => {
    await reset();
    await prisma.tenant.update({ where: { id: S.tenant.id }, data: { payoutPhone: "254712345678", depositHoldMinutes: 15 } });
    await expect(book({ staff: S.ownerStaff.id })).rejects.toBeInstanceOf(ValidationError); // no phone: refused before anything is held
    const r = await book({ staff: S.ownerStaff.id, phone: "254712345678" });
    expect(r.status).toBe("PENDING_PAYMENT");
    const [b] = await rows();
    expect(b.holdExpiresAt?.toISOString()).toBe("2031-07-01T12:15:00.000Z"); // now + 15 min
    await reset();
  });

  it("splits 'any available' bookings across people, lightest day first", async () => {
    await reset();
    await book({ startsAt: "2031-07-02T13:00:00.000Z" });
    await book({ startsAt: "2031-07-02T14:00:00.000Z" });
    const staffUsed = (await rows()).map((b) => b.staffId);
    expect(new Set(staffUsed).size).toBe(2); // second booking went to the person with fewer bookings
    await reset();
  });

  it("refuses start times that are not offered slots", async () => {
    await reset();
    const bad: [string, string][] = [
      ["off the 15-minute grid", "2031-07-02T14:07:00.000Z"],
      ["before opening", "2031-07-02T12:00:00.000Z"], // 08:00 local
      ["after closing", "2031-07-02T21:00:00.000Z"], // 17:00 local
      ["too late to fit the service", "2031-07-02T20:45:00.000Z"], // 16:45 + 30min > 17:00
      ["in the past", "2031-06-30T14:00:00.000Z"],
      ["inside the notice period", "2031-07-01T12:30:00.000Z"],
      ["beyond the horizon", "2031-12-01T14:00:00.000Z"],
    ];
    for (const [why, startsAt] of bad) {
      await expect(book({ startsAt }), why).rejects.toBeInstanceOf(SlotUnavailableError);
    }
    expect(await rows()).toHaveLength(0);
  });

  it("refuses a time that falls inside time off", async () => {
    await prisma.timeOff.createMany({
      data: [S.ownerStaff.id, S.staffUserStaff.id].map((staffId) => ({ tenantId: S.tenant.id, staffId, startsAt: new Date("2031-07-02T13:30:00Z"), endsAt: new Date("2031-07-02T15:00:00Z") })),
    });
    await expect(book()).rejects.toBeInstanceOf(SlotUnavailableError);
    await reset();
  });

  it("refuses unknown ids, inactive services, other shops' ids and staff who don't offer the service", async () => {
    await reset();
    await expect(book({ tenantSlug: "missing-" + run })).rejects.toBeInstanceOf(NotFoundError);
    await expect(book({ serviceId: O.service.id })).rejects.toBeInstanceOf(NotFoundError);
    await expect(book({ staff: O.ownerStaff.id })).rejects.toBeInstanceOf(NotFoundError);
    await prisma.staffService.deleteMany({ where: { staffId: S.staffUserStaff.id } });
    await expect(book({ staff: S.staffUserStaff.id })).rejects.toBeInstanceOf(NotFoundError);
    await prisma.staffService.create({ data: { tenantId: S.tenant.id, staffId: S.staffUserStaff.id, serviceId: S.service.id } });
    await prisma.service.update({ where: { id: S.service.id }, data: { active: false } });
    await expect(book()).rejects.toBeInstanceOf(NotFoundError);
    await reset();
    expect(await rows()).toHaveLength(0);
  });

  it("a bot that fills the hidden field is rejected and nothing is created", async () => {
    await expect(book({ website: "http://spam.example" })).rejects.toBeInstanceOf(ValidationError);
    expect(await rows()).toHaveLength(0);
  });

  it("a double-clicked submit by the same customer returns the SAME booking, not a 'slot taken' error", async () => {
    const email = `dbl-${run}@it.example.com`;
    const a = await book({ staff: S.ownerStaff.id, email });
    const b = await book({ staff: S.ownerStaff.id, email });
    expect(b.publicToken).toBe(a.publicToken);
    expect(await rows()).toHaveLength(1);
    await reset();
  });

  it("caps how many upcoming bookings one email can hold", async () => {
    await reset();
    const email = `cap-${run}@it.example.com`;
    for (const h of ["13:00", "14:00", "15:00", "16:00", "17:00"]) await book({ email, startsAt: `2031-07-02T${h}:00.000Z` });
    await expect(book({ email, startsAt: "2031-07-02T18:00:00.000Z" })).rejects.toMatchObject({ code: "TOO_MANY_BOOKINGS" });
    await reset();
  });

  it("throttles a client that keeps trying (per IP and shop)", async () => {
    await reset();
    const clientKey = `throttle-${run}`;
    const outcomes: string[] = [];
    for (let i = 0; i < 12; i++) {
      try {
        await book({ startsAt: "2031-07-02T08:00:00.000Z" }, { clientKey }); // never a valid slot
      } catch (e) {
        outcomes.push((e as Error).constructor.name);
      }
    }
    expect(outcomes.slice(0, 10).every((n) => n === "SlotUnavailableError")).toBe(true);
    expect(outcomes.slice(10)).toEqual(["RateLimitError", "RateLimitError"]);
    expect(RateLimitError).toBeDefined();
  });

  it("uses the shop's wall clock across daylight saving (9am stays 9am)", async () => {
    await reset();
    const early = new Date("2031-03-01T12:00:00Z");
    const a = await publicBooking.getAvailability(S.tenant.slug, S.service.id, S.ownerStaff.id, "2031-03-08", early);
    expect(a.days[0].slots[0]).toEqual({ startsAt: "2031-03-08T14:00:00.000Z", label: "9:00 AM" }); // Sat: EST
    expect(a.days[1].slots[0]).toEqual({ startsAt: "2031-03-09T13:00:00.000Z", label: "9:00 AM" }); // Sun: EDT
  });
});

describe("double booking cannot happen, even under races", () => {
  const settle = (ps: Promise<unknown>[]) => Promise.allSettled(ps);
  const wins = (rs: PromiseSettledResult<unknown>[]) => rs.filter((r) => r.status === "fulfilled").length;
  const losses = (rs: PromiseSettledResult<unknown>[]) => rs.filter((r) => r.status === "rejected") as PromiseRejectedResult[];

  it("sequential: the second attempt for a taken slot fails", async () => {
    await reset();
    await book({ staff: S.ownerStaff.id });
    await expect(book({ staff: S.ownerStaff.id })).rejects.toBeInstanceOf(SlotUnavailableError);
    expect(await rows()).toHaveLength(1);
  });

  it("25 simultaneous requests for one person's slot: exactly ONE wins", async () => {
    await reset();
    const results = await settle(Array.from({ length: 25 }, () => book({ staff: S.ownerStaff.id })));
    expect(wins(results)).toBe(1);
    expect(losses(results)).toHaveLength(24);
    for (const l of losses(results)) expect(l.reason).toBeInstanceOf(SlotUnavailableError); // a clean "slot taken", never a 500
    expect(await rows()).toHaveLength(1);
  });

  it("'any available' with two people: 8 simultaneous requests fill exactly both, never the same person twice", async () => {
    await reset();
    const results = await settle(Array.from({ length: 8 }, () => book({ staff: "any" })));
    expect(wins(results)).toBe(2);
    for (const l of losses(results)) expect(l.reason).toBeInstanceOf(SlotUnavailableError);
    const saved = await rows();
    expect(saved).toHaveLength(2);
    expect(new Set(saved.map((b) => b.staffId)).size).toBe(2);
  });

  it("overlapping (not identical) times race safely too: 10:00 and 10:15 for one person (30-minute service)", async () => {
    await reset();
    // Both starts are valid slots on the 15-minute grid, but they overlap each other.
    const results = await settle(
      Array.from({ length: 12 }, (_, i) => book({ staff: S.ownerStaff.id, startsAt: i % 2 ? "2031-07-02T14:15:00.000Z" : "2031-07-02T14:00:00.000Z" })),
    );
    expect(wins(results)).toBe(1);
    expect(await rows()).toHaveLength(1);
  });

  it("back-to-back bookings are both allowed", async () => {
    await reset();
    await book({ staff: S.ownerStaff.id, startsAt: "2031-07-02T14:00:00.000Z" });
    await book({ staff: S.ownerStaff.id, startsAt: "2031-07-02T14:30:00.000Z" });
    expect(await rows()).toHaveLength(2);
  });

  it("many customers sharing one NEW email at once do not crash on the customer row", async () => {
    await reset();
    const email = `same-${run}@it.example.com`;
    const slots = ["13:00", "14:00", "15:00", "16:00", "17:00"].map((h) => `2031-07-02T${h}:00.000Z`);
    const results = await settle(slots.map((startsAt) => book({ email, startsAt })));
    expect(wins(results)).toBe(5);
    expect(await prisma.customer.count({ where: { tenantId: S.tenant.id, email } })).toBe(1);
  });

  it("a cancelled booking frees its slot for the next customer", async () => {
    await reset();
    const first = await book({ staff: S.ownerStaff.id });
    const [b] = await rows();
    await expect(book({ staff: S.ownerStaff.id })).rejects.toBeInstanceOf(SlotUnavailableError);
    await bookingService.setBookingStatus(ownerCtx, b.id, "CANCELLED", NOW);
    const again = await book({ staff: S.ownerStaff.id });
    expect(again.publicToken).not.toBe(first.publicToken);
    expect((await rows({ status: "CONFIRMED" })).length).toBe(1);
  });
});

describe("holds: a pending booking blocks its slot only until it expires", () => {
  it("an unexpired hold blocks; after expiry the slot is offered and bookable, and the stale hold is cancelled", async () => {
    await reset();
    await prisma.tenant.update({ where: { id: S.tenant.id }, data: { payoutPhone: "254712345678", depositHoldMinutes: 15 } });
    const held = await book({ staff: S.ownerStaff.id, phone: "254712345678" });
    expect(held.status).toBe("PENDING_PAYMENT");

    const during = new Date(NOW.getTime() + 10 * 60_000); // hold still valid
    const blocked = await publicBooking.getAvailability(S.tenant.slug, S.service.id, S.ownerStaff.id, WED, during);
    expect(blocked.days[0].slots.map((s) => s.startsAt)).not.toContain(WED_10AM);
    await expect(book({ staff: S.ownerStaff.id, phone: "254712345678" }, { now: during })).rejects.toBeInstanceOf(SlotUnavailableError);

    const after = new Date(NOW.getTime() + 20 * 60_000); // hold expired
    const freed = await publicBooking.getAvailability(S.tenant.slug, S.service.id, S.ownerStaff.id, WED, after);
    expect(freed.days[0].slots.map((s) => s.startsAt)).toContain(WED_10AM);

    const next = await book({ staff: S.ownerStaff.id, phone: "254712345678" }, { now: after });
    expect(next.status).toBe("PENDING_PAYMENT");
    const all = await rows();
    expect(all.map((b) => [b.status, b.cancelReason]).sort()).toEqual([["CANCELLED", "hold_expired"], ["PENDING_PAYMENT", null]].sort());
    await reset();
  });
});

describe("the confirmation page data", () => {
  it("shows only that booking, addressed by its token, with the customer's first name", async () => {
    await reset();
    const r = await book({ name: "Dana Whoever", staff: S.ownerStaff.id });
    const c = await publicBooking.getConfirmation(S.tenant.slug, r.publicToken);
    expect(c.booking).toMatchObject({ status: "CONFIRMED", serviceName: `${S.marker} Cut`, firstName: "Dana", priceCents: 3000, depositCents: 500 });
    expect(JSON.stringify(c)).not.toContain("Whoever");
    await expect(publicBooking.getConfirmation(S.tenant.slug, "nope")).rejects.toBeInstanceOf(NotFoundError);
    await expect(publicBooking.getConfirmation(O.tenant.slug, r.publicToken)).rejects.toBeInstanceOf(NotFoundError); // another shop's page can't show it
    await reset();
  });
});

describe("dashboard status changes", () => {
  async function past(status: "CONFIRMED" | "CANCELLED" = "CONFIRMED") {
    const customer = await prisma.customer.findFirstOrThrow({ where: { tenantId: S.tenant.id } });
    return prisma.booking.create({
      data: { tenantId: S.tenant.id, serviceId: S.service.id, staffId: S.ownerStaff.id, customerId: customer.id, startsAt: new Date("2031-06-20T14:00:00Z"), endsAt: new Date("2031-06-20T14:30:00Z"), priceCents: 3000, depositCents: 500, status },
    });
  }

  it("marks a started booking completed or no-show, but not a future one", async () => {
    await reset();
    await book({ staff: S.ownerStaff.id });
    const [future] = await rows();
    await expect(bookingService.setBookingStatus(ownerCtx, future.id, "COMPLETED", NOW)).rejects.toMatchObject({ code: "NOT_STARTED" });
    const old = await past();
    expect((await bookingService.setBookingStatus(ownerCtx, old.id, "COMPLETED", NOW))?.status).toBe("COMPLETED");
    await reset();
  });

  it("final states stay final, and concurrent clicks cannot both succeed", async () => {
    await reset();
    await book({ staff: S.ownerStaff.id });
    const [b] = await rows();
    const results = await Promise.allSettled([
      bookingService.setBookingStatus(ownerCtx, b.id, "CANCELLED", NOW),
      bookingService.setBookingStatus(ownerCtx, b.id, "CANCELLED", NOW),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const lost = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(lost.reason).toBeInstanceOf(ConflictError);
    await expect(bookingService.setBookingStatus(ownerCtx, b.id, "COMPLETED", new Date("2032-01-01T00:00:00Z"))).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    await reset();
  });

  it("STAFF may change statuses; another shop's booking is NotFound", async () => {
    await reset();
    await book({ staff: S.ownerStaff.id });
    const [b] = await rows();
    const otherCtx = await ctxFor(prisma, O, "owner");
    await expect(bookingService.setBookingStatus(otherCtx, b.id, "CANCELLED", NOW)).rejects.toBeInstanceOf(NotFoundError);
    expect((await bookingService.setBookingStatus(staffCtx, b.id, "CANCELLED", NOW))?.status).toBe("CANCELLED");
    await reset();
  });

  it("upcoming and past views split on the current time", async () => {
    await reset();
    await book({ staff: S.ownerStaff.id });
    await past();
    expect((await bookingService.listBookingsByView(ownerCtx, "upcoming", NOW)).length).toBe(1);
    expect((await bookingService.listBookingsByView(ownerCtx, "past", NOW)).length).toBe(1);
    await reset();
  });
});
