import { expect, test, type Page } from "@playwright/test";
import { addDaysToDate, localInstant, todayIn } from "@/lib/dates";
import { createTestPrisma } from "../support/db.mts";
import { BASE, byLabel, byText, pageAs, signUpApi } from "../support/e2e-helpers.mts";
import { cleanupRun, openWholeWeek, seedShop, type ShopFixture } from "../support/fixtures.mts";

// Paying for Pro with M-Pesa (via the built-in simulator) and the Free plan's monthly booking limit.
test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

const prisma = createTestPrisma();
const run = Math.random().toString(36).slice(2, 8);
const TZ = "Africa/Nairobi";
const DAY = 86_400_000;
let S: ShopFixture;
let owner: Page;
let staff: Page;
const alertWith = (page: Page, text: string | RegExp) => page.getByRole("alert").filter({ hasText: text });

test.beforeAll(async ({ browser }) => {
  test.skip(process.env.MPESA_MODE !== "simulator", "Needs MPESA_MODE=simulator in .env (see .env.example)");
  const o = await signUpApi(prisma, run, "bill-owner");
  const s = await signUpApi(prisma, run, "bill-staff");
  S = await seedShop(prisma, run, "B", { owner: o, staffUser: s });
  await openWholeWeek(prisma, S);
  await prisma.tenant.update({ where: { id: S.tenant.id }, data: { timezone: TZ } });
  owner = await pageAs(browser, o.api);
  staff = await pageAs(browser, s.api);
});
test.afterAll(async () => {
  await prisma.rateLimit.deleteMany({ where: { key: { startsWith: "pub:" } } });
  await cleanupRun(prisma, run);
  await prisma.$disconnect();
});

const tenant = () => prisma.tenant.findUniqueOrThrow({ where: { id: S.tenant.id }, include: { subscription: true } });

async function payFor(page: Page, phone: string) {
  await page.goto("/dashboard/billing");
  await byLabel(page, "M-Pesa phone number").fill(phone);
  await page.getByRole("button", { name: /Pay KSh 2,500 with M-Pesa/ }).click();
}

test("a new shop is on Free and sees what Pro costs", async () => {
  await owner.goto("/dashboard/billing");
  await expect(owner.getByRole("heading", { name: "Free plan" })).toBeVisible();
  await expect(byText(owner, "of 30 bookings used this month")).toBeVisible();
  await expect(owner.getByRole("heading", { name: /Upgrade to Pro: KSh 2,500 for 30 days/ })).toBeVisible();
  await expect(byText(owner, "No payments yet.")).toBeVisible();
});

test("STAFF cannot open billing", async () => {
  await staff.goto("/dashboard/billing");
  await expect(staff.getByRole("heading", { name: /don.t have access/ })).toBeVisible();
});

test("a cancelled M-Pesa prompt leaves the shop on Free and says why", async () => {
  await payFor(owner, "0700000001");
  await expect(owner.getByRole("heading", { name: "Check your phone" })).toBeVisible();
  await expect(alertWith(owner, /You cancelled the M-Pesa prompt/)).toBeVisible({ timeout: 40_000 });
  expect((await tenant()).plan).toBe("FREE");
});

test("approving the prompt upgrades the shop to Pro for 30 days", async () => {
  await payFor(owner, "0712 345 678");
  await expect(owner.getByRole("heading", { name: "Check your phone" })).toBeVisible();
  await expect(owner.getByRole("heading", { name: "Pro plan" })).toBeVisible({ timeout: 40_000 });
  await expect(byText(owner, "Active")).toBeVisible();
  await expect(byText(owner, "Paid until")).toBeVisible();
  await expect(owner.getByRole("cell", { name: /^SIM/ })).toBeVisible(); // the M-Pesa receipt in the history

  const t = await tenant();
  expect(t.plan).toBe("PRO");
  const days = (t.subscription!.currentPeriodEnd.getTime() - Date.now()) / DAY;
  expect(days).toBeGreaterThan(29.9);
  expect(days).toBeLessThan(30.1);
});

test("renewing early EXTENDS the period instead of restarting it", async () => {
  const before = (await tenant()).subscription!.currentPeriodEnd.getTime();
  await owner.goto("/dashboard/billing");
  await expect(owner.getByRole("heading", { name: /Renew Pro for 30 more days/ })).toBeVisible();
  await byLabel(owner, "M-Pesa phone number").fill("0712 345 678");
  await owner.getByRole("button", { name: /Pay KSh 2,500 with M-Pesa/ }).click();
  await expect.poll(async () => (await tenant()).subscription!.currentPeriodEnd.getTime(), { timeout: 40_000 }).toBeGreaterThan(before);
  expect(((await tenant()).subscription!.currentPeriodEnd.getTime() - before) / DAY).toBeCloseTo(30, 1); // exactly one more period
});

test("on Free, hitting 30 bookings stops customers booking; upgrading lifts it at once", async ({ browser }) => {
  await prisma.subscription.deleteMany({ where: { tenantId: S.tenant.id } });
  await prisma.tenant.update({ where: { id: S.tenant.id }, data: { plan: "FREE" } });
  await prisma.subscriptionPayment.deleteMany({ where: { tenantId: S.tenant.id } });

  const tomorrow = addDaysToDate(todayIn(TZ, new Date()), 1);
  const customer = await prisma.customer.findFirstOrThrow({ where: { tenantId: S.tenant.id } });
  // Fill 30 bookings in the month of tomorrow's appointment (and this month, if different), on one staff member.
  for (const month of new Set([todayIn(TZ, new Date()).slice(0, 7), tomorrow.slice(0, 7)])) {
    const first = `${month}-01`;
    for (let i = 0; i < 30; i++) {
      const startsAt = localInstant(first, i * 30, TZ);
      await prisma.booking.create({ data: { tenantId: S.tenant.id, serviceId: S.service.id, staffId: S.ownerStaff.id, customerId: customer.id, startsAt, endsAt: new Date(startsAt.getTime() + 30 * 60_000), status: "CONFIRMED", priceCents: 3000, depositCents: 0 } });
    }
  }

  const page = await (await browser.newContext({ baseURL: BASE })).newPage();
  const nine = localInstant(tomorrow, 9 * 60, TZ).toISOString();
  const bookingUrl = `${BASE}/b/${S.tenant.slug}/${S.service.id}/details?staff=${S.staffUserStaff.id}&start=${encodeURIComponent(nine)}`;
  const fill = async (name: string) => {
    await page.goto(bookingUrl);
    await byLabel(page, "Your name").fill(name);
    await byLabel(page, "Email").fill(`${name.toLowerCase().replace(/\W+/g, "")}-${run}@it.example.com`);
    await page.getByRole("button", { name: "Confirm booking" }).click();
  };

  await fill("Limit Lucy");
  await expect(alertWith(page, "isn't taking any more online bookings this month")).toBeVisible();
  await expect(alertWith(page, /Free|Pro|upgrade/i)).toHaveCount(0); // customers never see plan details

  await owner.goto("/dashboard");
  await expect(byText(owner, "reached this month's booking limit")).toBeVisible(); // the owner is told

  // the owner upgrades (the simulator approves); the very next customer can book
  await payFor(owner, "0712 345 678");
  await expect(owner.getByRole("heading", { name: "Pro plan" })).toBeVisible({ timeout: 40_000 });
  await fill("Lifted Liz");
  await expect(page.getByRole("heading", { name: "You're booked!" })).toBeVisible();
});
