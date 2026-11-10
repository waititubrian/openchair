import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const holder = vi.hoisted(() => ({ current: null as null | ReturnType<typeof import("../support/mpesa-fake.mts").createMpesaFake> }));
vi.mock("@/lib/mpesa", async () => (await import("../support/mpesa-fake.mts")).mpesaModuleMock(holder));

import { ConflictError, ForbiddenError, PlanLimitError, ValidationError } from "@/lib/errors";
import * as billingService from "@/services/billing.service";
import * as mpesaSettlement from "@/services/mpesa-settlement.service";
import * as planService from "@/services/plan.service";
import * as publicBooking from "@/services/public-booking.service";
import { sweepExpiredHolds } from "@/services/booking-expiry.service";
import { createTestPrisma } from "../support/db.mts";
import { cleanupRun, ctxFor, openWholeWeek, seedShop, type ShopFixture } from "../support/fixtures.mts";
import { callbackBody, createMpesaFake } from "../support/mpesa-fake.mts";

// Pro subscriptions paid by M-Pesa, and the Free plan's monthly booking limit, against the real database.
const prisma = createTestPrisma();
const run = Math.random().toString(36).slice(2, 8);
const DAY = 86_400_000;
const NOW = new Date("2031-07-01T12:00:00Z"); // Tuesday 08:00 in New York
const PHONE = "254712345678";
const PRICE = 250_000; // KES 2,500

let F: ShopFixture; // the shop under test (FREE)
let O: ShopFixture; // another shop
let mpesa: ReturnType<typeof createMpesaFake>;
let keyN = 0;
const key = () => `bl${run}-${keyN++}`;
const user = (label: string) => prisma.user.create({ data: { email: `${label}-${run}@it.example.com`, name: label } });

const ownerCtx = async (shop = F) => ({ ...(await ctxFor(prisma, shop, "owner")) });
const staffCtx = async (shop = F) => ({ ...(await ctxFor(prisma, shop, "staff")), user: { id: shop.staffUser.id, email: shop.staffUser.email } });
const sub = (shop = F) => prisma.subscription.findUnique({ where: { tenantId: shop.tenant.id } });
const tenant = (shop = F) => prisma.tenant.findUniqueOrThrow({ where: { id: shop.tenant.id } });
const payments = (shop = F) => prisma.subscriptionPayment.findMany({ where: { tenantId: shop.tenant.id }, orderBy: { createdAt: "asc" } });

async function reset() {
  mpesa = createMpesaFake();
  holder.current = mpesa;
  for (const shop of [F, O]) {
    await prisma.subscriptionPayment.deleteMany({ where: { tenantId: shop.tenant.id } });
    await prisma.subscription.deleteMany({ where: { tenantId: shop.tenant.id } });
    await prisma.booking.deleteMany({ where: { tenantId: shop.tenant.id } });
    await prisma.tenant.update({ where: { id: shop.tenant.id }, data: { plan: "FREE" } });
    await prisma.staffMember.updateMany({ where: { tenantId: shop.tenant.id }, data: { active: true } });
  }
  await prisma.webhookEvent.deleteMany({ where: { source: "mpesa" } });
}

/** Start a Pro payment and run the callback that settles it, at a chosen time. */
async function pay(now: Date, shop = F, outcome: "approve" | { decline: number } = "approve", receipt = `RCP${Math.random().toString(36).slice(2, 8).toUpperCase()}`) {
  await billingService.startSubscriptionPayment(await ownerCtx(shop), "0712 345 678", now);
  const push = mpesa.last();
  if (outcome === "approve") mpesa.approve(push.checkoutRequestId);
  else mpesa.decline(push.checkoutRequestId, outcome.decline);
  const body = outcome === "approve" ? callbackBody({ checkoutRequestId: push.checkoutRequestId, amountCents: PRICE, phone: PHONE, receipt }) : callbackBody({ checkoutRequestId: push.checkoutRequestId, resultCode: outcome.decline });
  const result = await mpesaSettlement.handleStkCallback(body, now);
  return { push, result, body };
}

beforeAll(async () => {
  F = await seedShop(prisma, run, "F", { owner: await user("f-owner"), staffUser: await user("f-staff") });
  O = await seedShop(prisma, run, "O", { owner: await user("o-owner"), staffUser: await user("o-staff") });
  await openWholeWeek(prisma, F);
  await openWholeWeek(prisma, O);
});
beforeEach(reset);
afterAll(async () => {
  await prisma.webhookEvent.deleteMany({ where: { source: "mpesa" } });
  await prisma.rateLimit.deleteMany({ where: { key: { startsWith: "pub:" } } });
  await cleanupRun(prisma, run);
  await prisma.$disconnect();
});

describe("paying for Pro with M-Pesa", () => {
  it("sends a KES 2,500 prompt to the owner's phone and records a PENDING payment", async () => {
    const r = await billingService.startSubscriptionPayment(await ownerCtx(), "0712 345 678", NOW);
    expect(r.maskedPhone).toBe("07•• ••• 678");
    expect(mpesa.last()).toMatchObject({ amountCents: PRICE, phone: PHONE, description: "Pro plan" });
    const [p] = await payments();
    expect(p).toMatchObject({ status: "PENDING", amountCents: PRICE, phone: PHONE, currency: "kes", periodEnd: null });
    expect(await sub()).toBeNull(); // nothing is granted until M-Pesa confirms
    expect((await tenant()).plan).toBe("FREE");
  });

  it("only an OWNER can pay; bad numbers and rapid repeats are refused before Safaricom is contacted", async () => {
    await expect(billingService.startSubscriptionPayment(await staffCtx(), PHONE, NOW)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(billingService.startSubscriptionPayment(await ownerCtx(), "not a number", NOW)).rejects.toBeInstanceOf(ValidationError);
    expect(mpesa.pushes).toHaveLength(0);
    await billingService.startSubscriptionPayment(await ownerCtx(), PHONE, NOW);
    await expect(billingService.startSubscriptionPayment(await ownerCtx(), PHONE, new Date(NOW.getTime() + 10_000))).rejects.toMatchObject({ code: "PROMPT_RECENT" });
    expect(mpesa.pushes).toHaveLength(1);
  });

  it("a confirmed payment activates Pro for 30 days and records the receipt", async () => {
    const { result } = await pay(NOW, F, "approve", "SFTPRO0001");
    expect(result).toBe("processed");
    const s = (await sub())!;
    expect(s.plan).toBe("PRO");
    expect(s.currentPeriodEnd.toISOString()).toBe("2031-07-31T12:00:00.000Z"); // NOW + 30 days
    expect((await tenant()).plan).toBe("PRO");
    expect((await payments())[0]).toMatchObject({ status: "SUCCEEDED", mpesaReceipt: "SFTPRO0001", resultCode: 0 });
    expect(((await payments())[0].periodEnd as Date).toISOString()).toBe("2031-07-31T12:00:00.000Z");

    const summary = await billingService.getBillingSummary(await ownerCtx(), NOW);
    expect(summary).toMatchObject({ plan: "PRO", planLabel: "Pro", priceCents: PRICE });
    expect(summary.state).toMatchObject({ state: "active", daysLeft: 30 });
    expect(summary.payments[0]).toMatchObject({ status: "SUCCEEDED", receipt: "SFTPRO0001" });
  });

  it("a cancelled or failed prompt grants nothing and says why", async () => {
    const { result } = await pay(NOW, F, { decline: 1032 });
    expect(result).toBe("processed");
    expect(await sub()).toBeNull();
    expect((await tenant()).plan).toBe("FREE");
    expect((await payments())[0]).toMatchObject({ status: "FAILED", failureReason: "cancelled" });
    // and the owner can simply try again
    expect((await pay(new Date(NOW.getTime() + 120_000))).result).toBe("processed");
    expect((await tenant()).plan).toBe("PRO");
  });

  it("a FORGED callback cannot grant Pro: the status query decides", async () => {
    await billingService.startSubscriptionPayment(await ownerCtx(), PHONE, NOW);
    const push = mpesa.last();
    mpesa.answer(push.checkoutRequestId, { status: "pending" });
    const out = await mpesaSettlement.handleStkCallback(callbackBody({ checkoutRequestId: push.checkoutRequestId, amountCents: PRICE, receipt: "FREEPRO" }), NOW);
    expect(out).toBe("pending");
    expect(await sub()).toBeNull();
    expect((await tenant()).plan).toBe("FREE");
  });

  it("a status poll activates Pro when the callback never arrives", async () => {
    await billingService.startSubscriptionPayment(await ownerCtx(), PHONE, NOW);
    mpesa.approve(mpesa.last().checkoutRequestId);
    await mpesaSettlement.reconcileSubscriptionPayment(F.tenant.id, new Date(NOW.getTime() + 10_000));
    expect((await tenant()).plan).toBe("PRO");
    expect((await payments())[0]).toMatchObject({ status: "SUCCEEDED", mpesaReceipt: null });
  });

  it("duplicate callbacks grant ONE period, even delivered at the same instant", async () => {
    const { push, body } = await pay(NOW);
    const endAfterFirst = (await sub())!.currentPeriodEnd.getTime();
    for (let i = 0; i < 3; i++) expect(await mpesaSettlement.handleStkCallback(body, new Date(NOW.getTime() + 5000))).toBe("duplicate");

    // concurrent duplicates on a fresh payment
    await billingService.startSubscriptionPayment(await ownerCtx(), PHONE, new Date(NOW.getTime() + 120_000));
    const second = mpesa.last();
    mpesa.approve(second.checkoutRequestId);
    const b2 = callbackBody({ checkoutRequestId: second.checkoutRequestId, amountCents: PRICE, receipt: "RCP_2" });
    const outcomes = await Promise.all(Array.from({ length: 6 }, () => mpesaSettlement.handleStkCallback(b2, new Date(NOW.getTime() + 120_000))));
    expect(outcomes.filter((o) => o === "processed")).toHaveLength(1);
    expect((await sub())!.currentPeriodEnd.getTime()).toBe(endAfterFirst + 30 * DAY); // exactly one extension, not seven
    expect(push.checkoutRequestId).not.toBe(second.checkoutRequestId);
  });

  it("a payment for the wrong amount is never honoured", async () => {
    await billingService.startSubscriptionPayment(await ownerCtx(), PHONE, NOW);
    const push = mpesa.last();
    mpesa.approve(push.checkoutRequestId);
    await mpesaSettlement.handleStkCallback(callbackBody({ checkoutRequestId: push.checkoutRequestId, amountCents: 100, receipt: "CHEAP" }), NOW);
    expect(await sub()).toBeNull();
    expect((await tenant()).plan).toBe("FREE");
  });
});

describe("renewal", () => {
  it("renewing while active EXTENDS from the current end (paying early loses nothing)", async () => {
    await pay(NOW); // Pro until 2031-07-31T12:00Z
    const later = new Date(NOW.getTime() + 10 * DAY);
    await pay(later);
    expect((await sub())!.currentPeriodEnd.toISOString()).toBe("2031-08-30T12:00:00.000Z"); // old end + 30 days, not later + 30
  });

  it("renewing after the period lapsed restarts from the payment time", async () => {
    await prisma.subscription.create({ data: { tenantId: F.tenant.id, plan: "PRO", currentPeriodEnd: new Date(NOW.getTime() - 20 * DAY) } });
    await prisma.tenant.update({ where: { id: F.tenant.id }, data: { plan: "FREE" } });
    await pay(NOW);
    expect((await sub())!.currentPeriodEnd.toISOString()).toBe("2031-07-31T12:00:00.000Z");
    expect((await tenant()).plan).toBe("PRO");
  });

  it("paying during the grace period restarts from now (the old period already ended)", async () => {
    await prisma.subscription.create({ data: { tenantId: F.tenant.id, plan: "PRO", currentPeriodEnd: new Date(NOW.getTime() - 1 * DAY) } });
    await prisma.tenant.update({ where: { id: F.tenant.id }, data: { plan: "PRO" } });
    const before = await billingService.getBillingSummary(await ownerCtx(), NOW);
    expect(before.state.state).toBe("grace");
    await pay(NOW);
    expect((await sub())!.currentPeriodEnd.toISOString()).toBe("2031-07-31T12:00:00.000Z");
  });
});

describe("the daily downgrade", () => {
  const lapsedBy = async (shop: ShopFixture, days: number, now: Date) => {
    await prisma.subscription.upsert({ where: { tenantId: shop.tenant.id }, create: { tenantId: shop.tenant.id, plan: "PRO", currentPeriodEnd: new Date(now.getTime() - days * DAY) }, update: { currentPeriodEnd: new Date(now.getTime() - days * DAY) } });
    await prisma.tenant.update({ where: { id: shop.tenant.id }, data: { plan: "PRO" } });
  };

  it("drops a shop to Free only after the 3-day grace period, keeping its data and its OLDEST staff member", async () => {
    await lapsedBy(F, 2, NOW); // inside grace
    await lapsedBy(O, 4, NOW); // grace is over
    const result = await sweepExpiredHolds(NOW);
    expect(result.shopsDowngraded).toBeGreaterThanOrEqual(1);

    expect((await tenant(F)).plan).toBe("PRO"); // still within grace: untouched
    expect((await tenant(O)).plan).toBe("FREE");
    // Free allows 1 staff member: the older one stays active, the other is deactivated (not deleted)
    const staff = await prisma.staffMember.findMany({ where: { tenantId: O.tenant.id }, orderBy: { createdAt: "asc" } });
    expect(staff.map((s) => s.active)).toEqual([true, false]);
    expect(await prisma.service.count({ where: { tenantId: O.tenant.id } })).toBeGreaterThan(0);
    expect(await prisma.subscription.count({ where: { tenantId: O.tenant.id } })).toBe(1); // history kept
  });

  it("is idempotent, and never touches shops that are active, Free already, or never paid", async () => {
    await lapsedBy(O, 10, NOW);
    await prisma.subscription.upsert({ where: { tenantId: F.tenant.id }, create: { tenantId: F.tenant.id, plan: "PRO", currentPeriodEnd: new Date(NOW.getTime() + 5 * DAY) }, update: { currentPeriodEnd: new Date(NOW.getTime() + 5 * DAY) } });
    await prisma.tenant.update({ where: { id: F.tenant.id }, data: { plan: "PRO" } });
    await sweepExpiredHolds(NOW);
    const again = await sweepExpiredHolds(NOW);
    expect(again.shopsDowngraded).toBe(0);
    expect((await tenant(F)).plan).toBe("PRO"); // paid until the future
    expect((await tenant(O)).plan).toBe("FREE");
  });
});

// ---- the Free plan's monthly booking limit ---------------------------------------------------------
// Shop timezone is America/New_York: July 2031 is [2031-07-01T04:00Z, 2031-08-01T04:00Z).

describe("the Free plan's monthly booking limit", () => {
  /** Create `n` confirmed bookings in July 2031 directly (distinct hours, so no overlaps). */
  async function fillJuly(n: number, shop = F, status: "CONFIRMED" | "CANCELLED" | "COMPLETED" | "NO_SHOW" = "CONFIRMED") {
    const customer = await prisma.customer.findFirstOrThrow({ where: { tenantId: shop.tenant.id } });
    const base = Date.parse("2031-07-10T00:00:00Z");
    for (let i = 0; i < n; i++) {
      const startsAt = new Date(base + Math.floor(i / 10) * DAY + (10 + (i % 10)) * 3_600_000);
      await prisma.booking.create({ data: { tenantId: shop.tenant.id, serviceId: shop.service.id, staffId: shop.ownerStaff.id, customerId: customer.id, startsAt, endsAt: new Date(startsAt.getTime() + 1_800_000), status, priceCents: 3000, depositCents: 500 } });
    }
  }
  const book = (startsAt: string, shop = F, label = key()) =>
    publicBooking.createBooking(
      { tenantSlug: shop.tenant.slug, serviceId: shop.service.id, staff: shop.staffUserStaff.id, startsAt, name: "Lee Limit", email: `lee-${label}@it.example.com`, website: "" },
      { clientKey: key(), now: NOW },
    );
  const used = async (shop = F) => (await planService.getBookingUsage({ tenantId: shop.tenant.id, tenant: await tenant(shop) }, NOW)).used;

  it("allows exactly 30 a month: the 30th goes through, the 31st is refused with a customer-friendly message", async () => {
    await fillJuly(29);
    await expect(book("2031-07-02T14:00:00.000Z")).resolves.toMatchObject({ status: "CONFIRMED" });
    expect(await used()).toBe(30);
    const err = await book("2031-07-02T15:00:00.000Z").catch((e) => e);
    expect(err).toBeInstanceOf(PlanLimitError);
    expect(err.message).toMatch(/isn't taking any more online bookings this month/);
    expect(err.message).not.toMatch(/Free|Pro|plan|upgrade/i); // customers never see plan details
    expect(await used()).toBe(30);
  });

  it("simultaneous bookings at the limit cannot overshoot it (the per-shop, per-month lock)", async () => {
    await fillJuly(28);
    const slots = ["13:00", "14:00", "15:00", "16:00", "17:00", "18:00"].map((h) => `2031-07-03T${h}:00.000Z`);
    const results = await Promise.allSettled(slots.map((s, i) => book(s, F, `race${i}`)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2); // 28 + 2 = 30
    for (const r of results.filter((r): r is PromiseRejectedResult => r.status === "rejected")) expect(r.reason).toBeInstanceOf(PlanLimitError);
    expect(await used()).toBe(30);
  });

  it("counts the month in the SHOP's timezone: 23:30 on 31 July New York time is July, 00:30 on 1 August is August", async () => {
    // late-night hours around the month boundary (Thu 31 July 23:00-24:00 and Fri 1 Aug 00:00-02:00 shop time)
    await prisma.availabilityRule.createMany({ data: [
      { tenantId: F.tenant.id, staffId: F.staffUserStaff.id, dayOfWeek: 4, startMinute: 1380, endMinute: 1440 },
      { tenantId: F.tenant.id, staffId: F.staffUserStaff.id, dayOfWeek: 5, startMinute: 0, endMinute: 120 },
    ] });
    await fillJuly(30);
    await expect(book("2031-08-01T03:30:00.000Z")).rejects.toBeInstanceOf(PlanLimitError); // 23:30 EDT on 31 July: July is full
    await expect(book("2031-08-01T04:30:00.000Z")).resolves.toMatchObject({ status: "CONFIRMED" }); // 00:30 EDT on 1 Aug: a new month
  });

  it("cancelled bookings and lapsed holds don't count; completed and no-show bookings do", async () => {
    await fillJuly(20, F, "CANCELLED");
    await fillJuly(5, F, "COMPLETED");
    expect(await used()).toBe(5);
    await fillJuly(0);
    await prisma.booking.deleteMany({ where: { tenantId: F.tenant.id, status: "CANCELLED" } });
    await fillJuly(25, F, "NO_SHOW");
    expect(await used()).toBe(30);
    await expect(book("2031-07-04T14:00:00.000Z")).rejects.toBeInstanceOf(PlanLimitError);
  });

  it("is per shop: another shop's bookings don't use this shop's allowance", async () => {
    await fillJuly(30, O);
    await expect(book("2031-07-05T14:00:00.000Z", F)).resolves.toMatchObject({ status: "CONFIRMED" });
    await expect(book("2031-07-05T14:00:00.000Z", O)).rejects.toBeInstanceOf(PlanLimitError);
  });

  it("Pro has no limit, upgrading lifts it at once, and a downgrade puts it back", async () => {
    await fillJuly(30);
    await expect(book("2031-07-06T14:00:00.000Z")).rejects.toBeInstanceOf(PlanLimitError);
    await pay(NOW); // the owner upgrades
    await expect(book("2031-07-06T14:00:00.000Z")).resolves.toMatchObject({ status: "CONFIRMED" });
    expect(await used()).toBe(31); // more than the Free limit: allowed on Pro
    await prisma.tenant.update({ where: { id: F.tenant.id }, data: { plan: "FREE" } });
    await expect(book("2031-07-06T15:00:00.000Z")).rejects.toBeInstanceOf(PlanLimitError);
  });

  it("reports usage for the dashboard", async () => {
    await fillJuly(12);
    const u = await planService.getBookingUsage({ tenantId: F.tenant.id, tenant: await tenant() }, NOW);
    expect(u).toEqual({ used: 12, limit: 30, monthKey: "2031-07" });
    await prisma.tenant.update({ where: { id: F.tenant.id }, data: { plan: "PRO" } });
    expect((await planService.getBookingUsage({ tenantId: F.tenant.id, tenant: await tenant() }, NOW)).limit).toBeNull();
  });
});

describe("tenant isolation for billing", () => {
  it("each shop sees only its own payments and subscription", async () => {
    await pay(NOW, F);
    await pay(NOW, O);
    const a = await billingService.getBillingSummary(await ownerCtx(F), NOW);
    expect(a.payments).toHaveLength(1);
    expect(await payments(O)).toHaveLength(1);
    expect(JSON.stringify(a)).not.toContain(O.tenant.id);
    await expect(billingService.getBillingSummary(await staffCtx(F), NOW)).rejects.toBeInstanceOf(ForbiddenError);
    void ConflictError;
  });
});
