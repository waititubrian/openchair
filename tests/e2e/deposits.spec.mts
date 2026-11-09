import { expect, request as pwRequest, test, type Page } from "@playwright/test";
import { addDaysToDate, localInstant, todayIn } from "@/lib/dates";
import { createTestPrisma } from "../support/db.mts";
import { BASE, byLabel, byText, pageAs, signUpApi } from "../support/e2e-helpers.mts";
import { cleanupRun, openWholeWeek, seedShop, type ShopFixture } from "../support/fixtures.mts";

// Deposit bookings WITHOUT needing Stripe keys: what the customer and owner see around payment.
// (When keys are present, tests/e2e/stripe-payment.spec.mts drives the real hosted Checkout.)
// If Stripe is unreachable or unconfigured, a deposit booking must stay safely "held", never fail.
test.describe.configure({ mode: "serial" });
test.setTimeout(90_000);

const prisma = createTestPrisma();
const run = Math.random().toString(36).slice(2, 8);
const TZ = "America/New_York";
const stripeConfigured = Boolean(process.env.STRIPE_SECRET_KEY);
let S: ShopFixture;
let owner: Page;
let tomorrow: string;
let nineAm: string;

const alertWith = (page: Page, text: string | RegExp) => page.getByRole("alert").filter({ hasText: text });

test.beforeAll(async ({ browser }) => {
  const o = await signUpApi(prisma, run, "dep-owner");
  const s = await signUpApi(prisma, run, "dep-staff");
  S = await seedShop(prisma, run, "D", { owner: o, staffUser: s });
  await openWholeWeek(prisma, S);
  await prisma.tenant.update({ where: { id: S.tenant.id }, data: { stripeAccountId: null, chargesEnabled: false } });
  tomorrow = addDaysToDate(todayIn(TZ, new Date()), 1);
  nineAm = localInstant(tomorrow, 540, TZ).toISOString();
  owner = await pageAs(browser, o.api);
});
test.afterAll(async () => {
  await prisma.rateLimit.deleteMany({ where: { key: { startsWith: "pub:" } } });
  await cleanupRun(prisma, run);
  await prisma.$disconnect();
});

async function bookNineAm(page: Page, name: string) {
  await page.goto(`/b/${S.tenant.slug}/${S.service.id}/details?staff=${S.ownerStaff.id}&start=${encodeURIComponent(nineAm)}`);
  await byLabel(page, "Your name").fill(name);
  await byLabel(page, "Email").fill(`${name.toLowerCase().replace(/\W+/g, "")}-${run}@it.example.com`);
  await page.getByRole("button", { name: "Confirm booking" }).click();
}

test("the owner sees the payout status and is nudged to connect Stripe", async () => {
  await owner.goto("/dashboard");
  await expect(byText(owner, "Collect deposits by card")).toBeVisible();
  await owner.getByRole("link", { name: "Set up payouts" }).click();
  await expect(owner.getByRole("heading", { name: "Payouts" })).toBeVisible();
  await expect(owner.getByRole("heading", { name: "Not connected yet" })).toBeVisible();
  await expect(byText(owner, "Can accept card payments", { exact: true })).toBeVisible();
  await expect(byText(owner, "5% platform fee")).toBeVisible();
  if (!stripeConfigured) await expect(owner.getByRole("note").filter({ hasText: "aren't configured" })).toBeVisible();
});

test("a shop that isn't card-ready confirms immediately and says the deposit is paid in the shop", async ({ browser }) => {
  const ctx = await browser.newContext({ baseURL: BASE });
  const page = await ctx.newPage();
  await bookNineAm(page, "Walk In");
  await expect(page.getByRole("heading", { name: "You're booked!" })).toBeVisible();
  await expect(byText(page, "paid at the shop")).toBeVisible();
  await prisma.booking.deleteMany({ where: { tenantId: S.tenant.id } });
  await ctx.close();
});

test("a deposit booking whose payment can't start stays HELD and offers a retry (never fails)", async ({ browser }) => {
  // The shop becomes card-ready (fake account id): Stripe can't actually be reached from this test.
  await prisma.tenant.update({ where: { id: S.tenant.id }, data: { stripeAccountId: `acct_e2e_${run}`, chargesEnabled: true, detailsSubmitted: true, payoutsEnabled: true } });
  const ctx = await browser.newContext({ baseURL: BASE });
  const page = await ctx.newPage();
  await bookNineAm(page, "Dana Deposit");

  await expect(page).toHaveURL(/\/confirmation\//);
  await expect(page.getByRole("heading", { name: "Almost there" })).toBeVisible();
  await expect(byText(page, "Deposit due:")).toContainText("$5.00");
  await expect(byText(page, /your time is held until/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Pay $5.00 deposit" })).toBeVisible();
  const [b] = await prisma.booking.findMany({ where: { tenantId: S.tenant.id } });
  expect(b.status).toBe("PENDING_PAYMENT");
  expect(b.holdExpiresAt).not.toBeNull();

  // retrying payment gives a clear message, not a crash
  await page.getByRole("button", { name: "Pay $5.00 deposit" }).click();
  await expect(alertWith(page, /card payments|went wrong/)).toBeVisible();

  // while held, nobody else can take that time with that person
  const other = await browser.newContext({ baseURL: BASE });
  const otherPage = await other.newPage();
  await otherPage.goto(`/b/${S.tenant.slug}/${S.service.id}?staff=${S.ownerStaff.id}&date=${tomorrow}`);
  await expect(otherPage.getByRole("link", { name: "9:00 AM", exact: true })).toHaveCount(0);
  await other.close();
  await ctx.close();
});

test("when the hold lapses the page says so, and the time is free again for the next customer", async ({ browser }) => {
  const [held] = await prisma.booking.findMany({ where: { tenantId: S.tenant.id } });
  await prisma.booking.update({ where: { id: held.id }, data: { holdExpiresAt: new Date(Date.now() - 60_000) } });

  const ctx = await browser.newContext({ baseURL: BASE });
  const page = await ctx.newPage();
  await page.goto(`/b/${S.tenant.slug}/confirmation/${held.publicToken}`);
  await expect(byText(page, /has been released/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Pay .* deposit/ })).toHaveCount(0);

  // the slot is bookable again (an expired hold no longer blocks it) ...
  await page.goto(`/b/${S.tenant.slug}/${S.service.id}?staff=${S.ownerStaff.id}&date=${tomorrow}`);
  await expect(page.getByRole("link", { name: "9:00 AM", exact: true })).toBeVisible();

  // ... and a new customer can take it; the stale hold is cancelled
  await bookNineAm(page, "Next Customer");
  await expect(page.getByRole("heading", { name: "Almost there" })).toBeVisible();
  expect((await prisma.booking.findUniqueOrThrow({ where: { id: held.id } })).status).toBe("CANCELLED");
  expect(await prisma.booking.count({ where: { tenantId: S.tenant.id, status: "PENDING_PAYMENT" } })).toBe(1);
  await ctx.close();
});

test("the owner sees a pending booking and its status in the dashboard", async () => {
  await owner.goto("/dashboard/bookings");
  await expect(owner.getByRole("cell", { name: "pending payment" })).toBeVisible();
});

test("the webhook and cron endpoints refuse unauthenticated callers over real HTTP", async () => {
  const api = await pwRequest.newContext({ baseURL: BASE });
  const noSig = await api.post("/api/webhooks/stripe-connect", { data: "{}" });
  expect([400, 503]).toContain(noSig.status()); // 400 when a webhook secret is set, 503 when Stripe isn't configured
  const forged = await api.post("/api/webhooks/stripe-connect", { data: "{}", headers: { "stripe-signature": "t=1,v1=00" } });
  expect([400, 503]).toContain(forged.status());
  expect((await api.get("/api/cron/expire-holds")).status()).toBe(401);
  expect((await api.get("/api/cron/expire-holds", { headers: { authorization: "Bearer wrong" } })).status()).toBe(401);
});
