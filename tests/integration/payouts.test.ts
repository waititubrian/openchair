import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/mpesa", async () => (await import("../support/mpesa-fake.mts")).mpesaModuleMock({ current: null }));

import { ConflictError, ForbiddenError, ValidationError } from "@/lib/errors";
import * as payoutsService from "@/services/payouts.service";
import { createTestPrisma } from "../support/db.mts";
import { cleanupRun, ctxFor, openWholeWeek, seedShop, type ShopFixture } from "../support/fixtures.mts";

// The platform collects deposits and owes each shop (collected - platform fee - payouts made).
const prisma = createTestPrisma();
const run = Math.random().toString(36).slice(2, 8);
let S: ShopFixture;
let O: ShopFixture;
let admin: { id: string };
let seq = 0;
const user = (label: string, platformRole?: "PLATFORM_ADMIN") => prisma.user.create({ data: { email: `${label}-${run}@it.example.com`, name: label, platformRole } });
const ownerCtx = async (shop = S) => ({ ...(await ctxFor(prisma, shop, "owner")) });
const staffCtx = async (shop = S) => ({ ...(await ctxFor(prisma, shop, "staff")) });

/** A deposit that was paid: a booking (distinct time) plus its payment row. */
async function deposit(shop: ShopFixture, o: { amountCents: number; feeCents: number; status?: "SUCCEEDED" | "PENDING" | "FAILED" | "NEEDS_REFUND" | "REFUNDED" }) {
  const customer = await prisma.customer.findFirstOrThrow({ where: { tenantId: shop.tenant.id } });
  const startsAt = new Date(Date.parse("2031-09-01T06:00:00Z") + seq++ * 3_600_000);
  const booking = await prisma.booking.create({
    data: { tenantId: shop.tenant.id, serviceId: shop.service.id, staffId: shop.ownerStaff.id, customerId: customer.id, startsAt, endsAt: new Date(startsAt.getTime() + 1_800_000), status: "CONFIRMED", priceCents: Math.max(50_000, o.amountCents), depositCents: o.amountCents },
  });
  return prisma.payment.create({
    data: { tenantId: shop.tenant.id, bookingId: booking.id, phone: "254712345678", amountCents: o.amountCents, applicationFeeCents: o.feeCents, currency: "kes", status: o.status ?? "SUCCEEDED", checkoutRequestId: `ws_${run}_${seq}`, mpesaReceipt: o.status && o.status !== "SUCCEEDED" ? null : `RCP${run}${seq}` },
  });
}

beforeAll(async () => {
  S = await seedShop(prisma, run, "S", { owner: await user("s-owner"), staffUser: await user("s-staff") });
  O = await seedShop(prisma, run, "O", { owner: await user("o-owner"), staffUser: await user("o-staff") });
  await openWholeWeek(prisma, S);
  await openWholeWeek(prisma, O);
  admin = await user("platform-admin", "PLATFORM_ADMIN");
});
beforeEach(async () => {
  for (const shop of [S, O]) {
    await prisma.payout.deleteMany({ where: { tenantId: shop.tenant.id } });
    await prisma.payment.deleteMany({ where: { tenantId: shop.tenant.id } });
    await prisma.booking.deleteMany({ where: { tenantId: shop.tenant.id } });
    await prisma.tenant.update({ where: { id: shop.tenant.id }, data: { payoutPhone: "254722000111" } });
  }
});
afterAll(async () => {
  await cleanupRun(prisma, run);
  await prisma.$disconnect();
});

describe("what a shop is owed", () => {
  it("balance = successful deposits - platform fee - payouts already made (other statuses don't count)", async () => {
    await deposit(S, { amountCents: 10_000, feeCents: 500 });
    await deposit(S, { amountCents: 15_000, feeCents: 750 });
    await deposit(S, { amountCents: 99_000, feeCents: 4_950, status: "PENDING" });
    await deposit(S, { amountCents: 99_000, feeCents: 4_950, status: "FAILED" });
    await deposit(S, { amountCents: 20_000, feeCents: 1_000, status: "NEEDS_REFUND" });
    await payoutsService.recordPayout(admin, { tenantId: S.tenant.id, amountCents: 5_000, reference: "SEEDPAY" });

    const o = await payoutsService.getPayoutOverview(await ownerCtx());
    expect(o).toMatchObject({ collectedCents: 25_000, feeCents: 1_250, owedCents: 23_750, paidOutCents: 5_000, balanceCents: 18_750, depositCount: 2, needsRefundCount: 1 });
    expect(o.payouts).toHaveLength(1);
    expect(o.recent.length).toBe(5);
    expect(o.payoutPhone).toBe("254722000111");
  });

  it("each shop sees only its own money", async () => {
    await deposit(S, { amountCents: 10_000, feeCents: 500 });
    await deposit(O, { amountCents: 40_000, feeCents: 2_000 });
    const a = await payoutsService.getPayoutOverview(await ownerCtx(S));
    const b = await payoutsService.getPayoutOverview(await ownerCtx(O));
    expect(a.balanceCents).toBe(9_500);
    expect(b.balanceCents).toBe(38_000);
    expect(JSON.stringify(a)).not.toContain(O.tenant.id);
  });

  it("STAFF can't see or change anything about payouts", async () => {
    const staff = await staffCtx();
    await expect(payoutsService.getPayoutOverview(staff)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(payoutsService.setPayoutPhone(staff, "0712345678")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(payoutsService.clearPayoutPhone(staff)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("the payout number (which switches online deposits on)", () => {
  it("normalises a Kenyan number, rejects junk, and can be turned off", async () => {
    await payoutsService.clearPayoutPhone(await ownerCtx());
    expect((await payoutsService.getPayoutOverview(await ownerCtx())).depositsOnline).toBe(false);

    const saved = await payoutsService.setPayoutPhone(await ownerCtx(), "+254 722 000 111");
    expect(saved.payoutPhone).toBe("254722000111");
    expect((await prisma.tenant.findUniqueOrThrow({ where: { id: S.tenant.id } })).payoutPhone).toBe("254722000111");
    expect((await payoutsService.getPayoutOverview(await ownerCtx())).depositsOnline).toBe(true);

    await expect(payoutsService.setPayoutPhone(await ownerCtx(), "12345")).rejects.toBeInstanceOf(ValidationError);
    expect((await prisma.tenant.findUniqueOrThrow({ where: { id: S.tenant.id } })).payoutPhone).toBe("254722000111"); // unchanged by the bad attempt
  });
});

describe("recording a payout (platform admin only)", () => {
  it("is refused for shop owners, staff and unknown users, however they ask", async () => {
    await deposit(S, { amountCents: 10_000, feeCents: 500 });
    const shopOwner = (await ownerCtx()).user;
    await expect(payoutsService.recordPayout({ id: shopOwner.id }, { tenantId: S.tenant.id, amountCents: 1_000 })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(payoutsService.recordPayout({ id: "nobody" }, { tenantId: S.tenant.id, amountCents: 1_000 })).rejects.toBeInstanceOf(ForbiddenError);
    expect(await prisma.payout.count({ where: { tenantId: S.tenant.id } })).toBe(0);
  });

  it("validates the amount and the shop", async () => {
    await deposit(S, { amountCents: 10_000, feeCents: 500 });
    for (const amountCents of [0, -100, 150, 1.5]) {
      await expect(payoutsService.recordPayout(admin, { tenantId: S.tenant.id, amountCents }), String(amountCents)).rejects.toBeInstanceOf(ValidationError);
    }
    await expect(payoutsService.recordPayout(admin, { tenantId: S.tenant.id, amountCents: 9_600 })).rejects.toMatchObject({ code: "EXCEEDS_BALANCE" }); // owed is 9,500
    await prisma.tenant.update({ where: { id: S.tenant.id }, data: { payoutPhone: null } });
    await expect(payoutsService.recordPayout(admin, { tenantId: S.tenant.id, amountCents: 1_000 })).rejects.toMatchObject({ code: "NO_PAYOUT_PHONE" });
    expect(await prisma.payout.count({ where: { tenantId: S.tenant.id } })).toBe(0);
  });

  it("records the payout to the shop's number and lowers the balance", async () => {
    await deposit(S, { amountCents: 20_000, feeCents: 1_000 });
    const p = await payoutsService.recordPayout(admin, { tenantId: S.tenant.id, amountCents: 12_000, reference: "SFTPAY001", note: "Week 1" });
    expect(p).toMatchObject({ amountCents: 12_000, phone: "254722000111", reference: "SFTPAY001", note: "Week 1" });
    expect((await payoutsService.getPayoutOverview(await ownerCtx())).balanceCents).toBe(7_000);
  });

  it("two simultaneous payouts cannot both spend the same balance", async () => {
    await deposit(S, { amountCents: 10_000, feeCents: 0 }); // owed: KES 100
    const results = await Promise.allSettled([
      payoutsService.recordPayout(admin, { tenantId: S.tenant.id, amountCents: 6_000 }),
      payoutsService.recordPayout(admin, { tenantId: S.tenant.id, amountCents: 6_000 }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError);
    expect(await prisma.payout.count({ where: { tenantId: S.tenant.id } })).toBe(1);
    expect((await payoutsService.getPayoutOverview(await ownerCtx())).balanceCents).toBe(4_000);
  });

  it("cannot pay out money that belongs to another shop", async () => {
    await deposit(O, { amountCents: 50_000, feeCents: 0 });
    await expect(payoutsService.recordPayout(admin, { tenantId: S.tenant.id, amountCents: 1_000 })).rejects.toMatchObject({ code: "EXCEEDS_BALANCE" }); // S has nothing owed
  });
});
