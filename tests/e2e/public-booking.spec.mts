import { expect, test, type Page } from "@playwright/test";
import { addDaysToDate, localInstant, todayIn } from "@/lib/dates";
import { createTestPrisma } from "../support/db.mts";
import { byLabel, pageAs, signUpApi, BASE } from "../support/e2e-helpers.mts";
import { cleanupRun, openWholeWeek, seedShop, type ShopFixture } from "../support/fixtures.mts";

// The customer's journey with no login, and the dashboard side of the same bookings.
// A fresh shop is open every day 09:00-17:00 in America/New_York, so tomorrow 9:00 AM is always offered.
test.describe.configure({ mode: "serial" });
test.setTimeout(90_000);

const prisma = createTestPrisma();
const run = Math.random().toString(36).slice(2, 8);
const TZ = "America/New_York";
let S: ShopFixture;
let owner: Page;
let tomorrow: string;
let nineAmUtc: string; // tomorrow 09:00 shop time, as the ISO instant the app uses

const alertWith = (page: Page, text: string | RegExp) => page.getByRole("alert").filter({ hasText: text });

test.beforeAll(async ({ browser }) => {
  const o = await signUpApi(prisma, run, "pub-owner");
  const s = await signUpApi(prisma, run, "pub-staff");
  S = await seedShop(prisma, run, "B", { owner: o, staffUser: s });
  await openWholeWeek(prisma, S);
  tomorrow = addDaysToDate(todayIn(TZ, new Date()), 1);
  nineAmUtc = localInstant(tomorrow, 540, TZ).toISOString();
  owner = await pageAs(browser, o.api);
});
test.afterAll(async () => {
  await prisma.rateLimit.deleteMany({ where: { key: { startsWith: "pub:" } } });
  await cleanupRun(prisma, run);
  await prisma.$disconnect();
});

const liveBookings = () => prisma.booking.findMany({ where: { tenantId: S.tenant.id, status: { in: ["CONFIRMED", "PENDING_PAYMENT"] } } });

test("a customer books a time with no account, and the shop sees it", async ({ browser }) => {
  const ctx = await browser.newContext({ baseURL: BASE });
  const page = await ctx.newPage();

  await page.goto(`/b/${S.tenant.slug}`);
  await expect(page.getByRole("heading", { name: S.tenant.name })).toBeVisible();
  await page.getByRole("link", { name: new RegExp(`${S.marker} Cut`) }).click();

  // time picker: pick tomorrow, then 9:00 AM
  await expect(page.getByRole("heading", { name: `${S.marker} Cut` })).toBeVisible();
  await page.locator(`a[href*="date=${tomorrow}"]`).click();
  await expect(page).toHaveURL(new RegExp(`date=${tomorrow}`)); // don't pick a time from the previous day's list
  await page.getByRole("link", { name: "9:00 AM", exact: true }).click();

  // details
  await expect(page.getByRole("heading", { name: "Almost done" })).toBeVisible();
  await expect(page.getByText(TZ).first()).toBeVisible();
  await byLabel(page, "Your name").fill("Riley Customer");
  await byLabel(page, "Email").fill(`riley-${run}@it.example.com`);
  await byLabel(page, "Phone (optional)").fill("0712 345 678");
  await page.getByRole("button", { name: "Confirm booking" }).click();

  await expect(page).toHaveURL(/\/confirmation\//);
  await expect(page.getByRole("heading", { name: "You're booked!" })).toBeVisible();
  await expect(page.getByText("9:00 AM").first()).toBeVisible();

  const [b] = await liveBookings();
  expect(b.status).toBe("CONFIRMED");
  expect(b.startsAt.toISOString()).toBe(nineAmUtc);
  expect(b.priceCents).toBe(3000);

  // the confirmation link doesn't expose other people's data and isn't indexable
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  expect(await page.content()).not.toContain(`riley-${run}@`);

  // the shop sees it in the dashboard
  await owner.goto("/dashboard/bookings");
  await expect(owner.getByRole("cell", { name: "Riley Customer" })).toBeVisible();
  await ctx.close();
});

test("the owner cancels it from the dashboard and the time becomes available again", async ({ browser }) => {
  await owner.goto("/dashboard/bookings");
  await owner.getByRole("link", { name: /\d{4}/ }).first().click();
  await expect(owner.getByText("Riley Customer", { exact: false }).first()).toBeVisible();
  await owner.getByRole("button", { name: "Cancel booking" }).click();
  await owner.getByRole("button", { name: "Yes, cancel it" }).click();
  await expect(owner.getByText("cancelled").first()).toBeVisible();
  expect(await liveBookings()).toHaveLength(0);

  // a second customer can now take that exact time with that person
  const ctx = await browser.newContext({ baseURL: BASE });
  const page = await ctx.newPage();
  await page.goto(`/b/${S.tenant.slug}/${S.service.id}?staff=${S.ownerStaff.id}&date=${tomorrow}`);
  await expect(page.getByRole("link", { name: "9:00 AM", exact: true })).toBeVisible();
  await ctx.close();
});

test("two customers submit the SAME time at the same moment: exactly one gets it", async ({ browser }) => {
  const detailsUrl = `/b/${S.tenant.slug}/${S.service.id}/details?staff=${S.ownerStaff.id}&start=${encodeURIComponent(nineAmUtc)}`;
  const mk = async (n: number) => {
    const ctx = await browser.newContext({ baseURL: BASE });
    const page = await ctx.newPage();
    await page.goto(detailsUrl);
    await byLabel(page, "Your name").fill(`Racer ${n}`);
    await byLabel(page, "Email").fill(`racer${n}-${run}@it.example.com`);
    return { ctx, page };
  };
  const a = await mk(1);
  const b = await mk(2);

  // both forms are filled and ready; fire both submits together
  await Promise.all([a.page.getByRole("button", { name: "Confirm booking" }).click(), b.page.getByRole("button", { name: "Confirm booking" }).click()]);

  const outcome = async (p: Page) => {
    await expect(p.getByRole("heading", { name: "You're booked!" }).or(alertWith(p, "just taken"))).toBeVisible({ timeout: 20_000 });
    return p.url().includes("/confirmation/") ? "booked" : "taken";
  };
  const outcomes = [await outcome(a.page), await outcome(b.page)].sort();
  expect(outcomes).toEqual(["booked", "taken"]);
  expect(await liveBookings()).toHaveLength(1); // the database agrees: one booking, not two

  // the loser is offered a way forward, and that time is no longer listed for this person
  const loser = a.page.url().includes("/confirmation/") ? b.page : a.page;
  await loser.getByRole("link", { name: "Choose another time" }).click();
  await loser.locator(`a[href*="date=${tomorrow}"]`).click();
  await expect(loser.getByRole("link", { name: "9:00 AM", exact: true })).toHaveCount(0);
  await expect(loser.getByRole("link", { name: "9:15 AM", exact: true })).toHaveCount(0); // 9:00-9:30 blocks 9:15 too
  await expect(loser.getByRole("link", { name: "9:30 AM", exact: true })).toBeVisible(); // back-to-back is fine
  await a.ctx.close();
  await b.ctx.close();
});

test("choosing 'anyone' offers the same time through the other person", async ({ browser }) => {
  const ctx = await browser.newContext({ baseURL: BASE });
  const page = await ctx.newPage();
  await page.goto(`/b/${S.tenant.slug}/${S.service.id}?date=${tomorrow}`);
  await expect(page.getByRole("link", { name: "9:00 AM", exact: true })).toBeVisible(); // the other person is still free
  await ctx.close();
});

test("links that don't exist show a friendly page, not an error", async ({ browser }) => {
  const ctx = await browser.newContext({ baseURL: BASE });
  const page = await ctx.newPage();
  for (const path of [`/b/no-such-shop-${run}`, `/b/${S.tenant.slug}/not-a-service`, `/b/${S.tenant.slug}/confirmation/not-a-token`]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: /couldn.t find that page/ }), path).toBeVisible();
  }
  await ctx.close();
});

test("a details link with a bad time goes back to the time picker", async ({ browser }) => {
  const ctx = await browser.newContext({ baseURL: BASE });
  const page = await ctx.newPage();
  await page.goto(`/b/${S.tenant.slug}/${S.service.id}/details?start=garbage`);
  await expect(page).toHaveURL(new RegExp(`/b/${S.tenant.slug}/${S.service.id}$`));
  await ctx.close();
});

test("a time that isn't on offer is refused by the server even if the form is forged", async ({ browser }) => {
  const ctx = await browser.newContext({ baseURL: BASE });
  const page = await ctx.newPage();
  const bogus = localInstant(tomorrow, 3 * 60, TZ).toISOString(); // 3:00 AM: the shop is closed
  await page.goto(`/b/${S.tenant.slug}/${S.service.id}/details?staff=${S.ownerStaff.id}&start=${encodeURIComponent(bogus)}`);
  await byLabel(page, "Your name").fill("Forger");
  await byLabel(page, "Email").fill(`forger-${run}@it.example.com`);
  await page.getByRole("button", { name: "Confirm booking" }).click();
  await expect(alertWith(page, "just taken")).toBeVisible();
  expect(await prisma.booking.count({ where: { tenantId: S.tenant.id, customer: { email: `forger-${run}@it.example.com` } } })).toBe(0);
  await ctx.close();
});

test("a week with no availability says so, and the page still works on a phone", async ({ browser }) => {
  await prisma.availabilityRule.deleteMany({ where: { tenantId: S.tenant.id } });
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 390, height: 800 } });
  const page = await ctx.newPage();
  await page.goto(`/b/${S.tenant.slug}/${S.service.id}`);
  await expect(page.getByText("No times available this week")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0); // no sideways scrolling on a 390px screen
  await ctx.close();
});
