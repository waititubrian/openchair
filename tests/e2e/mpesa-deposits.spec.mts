import { expect, request as pwRequest, test, type Page } from "@playwright/test";
import { addDaysToDate, localInstant, todayIn } from "@/lib/dates";
import { createTestPrisma } from "../support/db.mts";
import { BASE, byLabel, byText, pageAs, signUpApi } from "../support/e2e-helpers.mts";
import { cleanupRun, openWholeWeek, seedShop, type ShopFixture } from "../support/fixtures.mts";

// Deposits paid with M-Pesa, end to end, using the built-in SIMULATOR (MPESA_MODE=simulator in .env), which
// behaves like Safaricom: the prompt is acknowledged at once, the "customer" answers ~2 seconds later, and
// the result arrives as a Daraja-shaped callback to our real callback route. The phone number picks the outcome:
//   0700000001 cancels   0700000002 no funds   0700000003 never answers   0700000004 wrong PIN   other: approves
test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

const prisma = createTestPrisma();
const run = Math.random().toString(36).slice(2, 8);
const TZ = "Africa/Nairobi";
const GOOD = "0712 345 678";
let S: ShopFixture;
let owner: Page;
let tomorrow: string;
const slot = (hour: number) => localInstant(tomorrow, hour * 60, TZ).toISOString();
const callbackSecret = process.env.MPESA_CALLBACK_SECRET ?? "";
const alertWith = (page: Page, text: string | RegExp) => page.getByRole("alert").filter({ hasText: text });

test.beforeAll(async ({ browser }) => {
  test.skip(process.env.MPESA_MODE !== "simulator", "Needs MPESA_MODE=simulator in .env (see .env.example)");
  const o = await signUpApi(prisma, run, "mp-owner");
  const s = await signUpApi(prisma, run, "mp-staff");
  S = await seedShop(prisma, run, "M", { owner: o, staffUser: s });
  await openWholeWeek(prisma, S);
  await prisma.tenant.update({ where: { id: S.tenant.id }, data: { timezone: TZ, payoutPhone: "254722000111" } });
  await prisma.service.update({ where: { id: S.service.id }, data: { priceCents: 50_000, depositCents: 10_000 } }); // KES 500, deposit KES 100
  tomorrow = addDaysToDate(todayIn(TZ, new Date()), 1);
  owner = await pageAs(browser, o.api);
});
test.afterAll(async () => {
  await prisma.rateLimit.deleteMany({ where: { key: { startsWith: "pub:" } } });
  await cleanupRun(prisma, run);
  await prisma.$disconnect();
});

let n = 0;
async function book(page: Page, hour: number, phone: string, name = `Cust ${++n}`) {
  await page.goto(`${BASE}/b/${S.tenant.slug}/${S.service.id}/details?staff=${S.ownerStaff.id}&start=${encodeURIComponent(slot(hour))}`);
  await byLabel(page, "Your name").fill(name);
  await byLabel(page, "Email").fill(`${name.toLowerCase().replace(/\W+/g, "")}-${run}@it.example.com`);
  await byLabel(page, "M-Pesa phone number").fill(phone);
  await page.getByRole("button", { name: "Book and pay deposit" }).click();
  await expect(page).toHaveURL(/\/confirmation\//);
}
const bookingAt = (hour: number) => prisma.booking.findFirstOrThrow({ where: { tenantId: S.tenant.id, startsAt: new Date(slot(hour)) }, include: { payments: { orderBy: { createdAt: "asc" } } } });

test("the owner sees online deposits switched on, with nothing owed yet", async () => {
  await owner.goto("/dashboard/payouts");
  await expect(owner.getByRole("heading", { name: "Online deposits are ON" })).toBeVisible();
  await expect(owner.getByTestId("balance-owed")).toHaveText("KSh 0");
});

test("a customer pays a KSh 100 deposit with M-Pesa: prompt, PIN, confirmed", async ({ browser }) => {
  const page = await (await browser.newContext({ baseURL: BASE })).newPage();
  await page.goto(`/b/${S.tenant.slug}`);
  await expect(byText(page, "KSh 500").first()).toBeVisible();
  await expect(byText(page, "KSh 100 deposit to book")).toBeVisible();

  await book(page, 9, GOOD);
  await expect(page.getByRole("heading", { name: "Check your phone" })).toBeVisible(); // the prompt was sent
  await expect(byText(page, "07•• ••• 678").first()).toBeVisible(); // masked, not the full number
  await expect(page.getByRole("heading", { name: "You're booked!" })).toBeVisible({ timeout: 30_000 }); // the "customer" approved
  await expect(byText(page, "KSh 100 paid with M-Pesa")).toBeVisible();

  const b = await bookingAt(9);
  expect(b.status).toBe("CONFIRMED");
  expect(b.payments).toHaveLength(1);
  expect(b.payments[0]).toMatchObject({ status: "SUCCEEDED", amountCents: 10_000, applicationFeeCents: 500, currency: "kes", resultCode: 0 });
  expect(b.payments[0].mpesaReceipt).toMatch(/^SIM/);
  expect(b.payments[0].phone).toBe("254712345678");
});

test("cancelling the prompt shows why, keeps the time held, and the customer can send it again", async ({ browser }) => {
  const page = await (await browser.newContext({ baseURL: BASE })).newPage();
  await book(page, 10, "0700000001");
  await expect(alertWith(page, "You cancelled the M-Pesa prompt.")).toBeVisible({ timeout: 30_000 });
  expect((await bookingAt(10)).status).toBe("PENDING_PAYMENT"); // still held

  await byLabel(page, "M-Pesa phone number").fill(GOOD);
  await page.getByRole("button", { name: "Send M-Pesa prompt again" }).click();
  await expect(page.getByRole("heading", { name: "You're booked!" })).toBeVisible({ timeout: 40_000 });
  const b = await bookingAt(10);
  expect(b.payments.map((p) => [p.status, p.failureReason])).toEqual([["FAILED", "cancelled"], ["SUCCEEDED", null]]);
});

test("insufficient funds is explained", async ({ browser }) => {
  const page = await (await browser.newContext({ baseURL: BASE })).newPage();
  await book(page, 11, "0700000002");
  await expect(alertWith(page, /balance was too low/)).toBeVisible({ timeout: 30_000 });
});

test("a phone that never answers is eventually reported as no response (found by checking with Safaricom, no callback)", async ({ browser }) => {
  const page = await (await browser.newContext({ baseURL: BASE })).newPage();
  await book(page, 12, "0700000003");
  await expect(page.getByRole("heading", { name: "Check your phone" })).toBeVisible();
  await expect(alertWith(page, /didn't get a response from your phone/)).toBeVisible({ timeout: 45_000 });
  expect((await bookingAt(12)).payments[0].failureReason).toBe("no_response");
});

test("a mistyped phone number is caught on the form and nothing is held", async ({ browser }) => {
  const page = await (await browser.newContext({ baseURL: BASE })).newPage();
  await page.goto(`${BASE}/b/${S.tenant.slug}/${S.service.id}/details?staff=${S.ownerStaff.id}&start=${encodeURIComponent(slot(13))}`);
  await byLabel(page, "Your name").fill("Typo Tina");
  await byLabel(page, "Email").fill(`typo-${run}@it.example.com`);
  await byLabel(page, "M-Pesa phone number").fill("12345");
  await page.getByRole("button", { name: "Book and pay deposit" }).click();
  await expect(byText(page, "Enter a Kenyan mobile number")).toBeVisible();
  expect(await prisma.booking.count({ where: { tenantId: S.tenant.id, startsAt: new Date(slot(13)) } })).toBe(0);
});

test("the owner's balance is what customers paid minus the 5% platform fee", async () => {
  await owner.goto("/dashboard/payouts");
  await expect(byText(owner, "Deposits collected (2)")).toBeVisible(); // the 9:00 and (retried) 10:00 payments
  await expect(owner.getByTestId("balance-owed")).toHaveText("KSh 190"); // 200 - 10
  await expect(byText(owner, "- KSh 10").first()).toBeVisible();
  await expect(owner.getByRole("cell", { name: /^SIM/ }).first()).toBeVisible(); // the M-Pesa receipts are listed
});

test("the callback URL can't be used to fake a payment", async ({ browser }) => {
  const page = await (await browser.newContext({ baseURL: BASE })).newPage();
  await book(page, 14, "0700000003"); // this prompt will never be answered
  const payment = (await bookingAt(14)).payments[0];
  const forged = { Body: { stkCallback: { MerchantRequestID: "m", CheckoutRequestID: payment.checkoutRequestId, ResultCode: 0, ResultDesc: "ok", CallbackMetadata: { Item: [{ Name: "Amount", Value: 100 }, { Name: "MpesaReceiptNumber", Value: "FORGED1" }] } } } };

  const api = await pwRequest.newContext({ baseURL: BASE });
  expect((await api.post("/api/webhooks/mpesa/wrong-secret", { data: forged })).status()).toBe(404);
  expect((await api.post(`/api/webhooks/mpesa/${callbackSecret}`, { data: "not json", headers: { "content-type": "application/json" } })).status()).toBe(400);
  const unknown = await api.post(`/api/webhooks/mpesa/${callbackSecret}`, { data: { Body: { stkCallback: { ...forged.Body.stkCallback, CheckoutRequestID: "ws_CO_nobody" } } } });
  expect(unknown.status()).toBe(200);
  expect((await unknown.json()).outcome).toBe("ignored");

  // The attacker has the real URL and a real CheckoutRequestID and claims success. Safaricom (here the
  // simulator) says the phone never answered, so nothing is confirmed.
  const claim = await api.post(`/api/webhooks/mpesa/${callbackSecret}`, { data: forged });
  expect(claim.status()).toBe(200);
  const after = await bookingAt(14);
  expect(after.status).not.toBe("CONFIRMED");
  expect(after.payments[0].status).not.toBe("SUCCEEDED");
  expect(after.payments[0].mpesaReceipt).toBeNull();
});

test("when the hold lapses the page says so and the time is bookable again", async ({ browser }) => {
  const held = await bookingAt(14);
  await prisma.booking.update({ where: { id: held.id }, data: { holdExpiresAt: new Date(Date.now() - 60_000) } });
  const page = await (await browser.newContext({ baseURL: BASE })).newPage();
  await page.goto(`/b/${S.tenant.slug}/confirmation/${held.publicToken}`);
  await expect(page.getByRole("heading", { name: "Your time was released" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Send M-Pesa prompt|Pay KSh/ })).toHaveCount(0);

  await page.goto(`/b/${S.tenant.slug}/${S.service.id}?staff=${S.ownerStaff.id}&date=${tomorrow}`);
  await expect(page.getByRole("link", { name: "2:00 PM", exact: true })).toBeVisible();
});

test("with online deposits switched off, bookings confirm at once and the deposit is paid in the shop", async ({ browser }) => {
  await owner.goto("/dashboard/payouts");
  await owner.getByRole("button", { name: "Turn off online deposits" }).click();
  await owner.getByRole("button", { name: "Yes, turn off" }).click();
  await expect(owner.getByRole("heading", { name: "Online deposits are OFF" })).toBeVisible();

  const page = await (await browser.newContext({ baseURL: BASE })).newPage();
  await page.goto(`${BASE}/b/${S.tenant.slug}/${S.service.id}/details?staff=${S.ownerStaff.id}&start=${encodeURIComponent(slot(15))}`);
  await byLabel(page, "Your name").fill("Walk Wanjiru");
  await byLabel(page, "Email").fill(`walk-${run}@it.example.com`);
  await expect(byLabel(page, "Phone (optional)")).toBeVisible(); // no M-Pesa number needed
  await page.getByRole("button", { name: "Confirm booking" }).click();
  await expect(page.getByRole("heading", { name: "You're booked!" })).toBeVisible();
  await expect(byText(page, "paid at the shop")).toBeVisible();

  // and the owner can switch it back on by entering a number
  await owner.goto("/dashboard/payouts");
  await byLabel(owner, "M-Pesa number for your payouts").fill("0722 000 111");
  await owner.getByRole("button", { name: "Save number" }).click();
  await expect(owner.getByRole("heading", { name: "Online deposits are ON" })).toBeVisible();
  expect((await prisma.tenant.findUniqueOrThrow({ where: { id: S.tenant.id } })).payoutPhone).toBe("254722000111");
});
