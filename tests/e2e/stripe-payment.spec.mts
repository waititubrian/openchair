import { expect, test, type Page } from "@playwright/test";
import Stripe from "stripe";
import { addDaysToDate, localInstant, todayIn } from "@/lib/dates";
import { createTestPrisma } from "../support/db.mts";
import { BASE, byLabel, signUpApi } from "../support/e2e-helpers.mts";
import { cleanupRun, openWholeWeek, seedShop, type ShopFixture } from "../support/fixtures.mts";

// @stripe: a REAL deposit payment through Stripe's hosted Checkout in TEST mode.
//
// Runs only when STRIPE_SECRET_KEY (a sk_test_... key) is set; otherwise every test is skipped so
// the rest of the suite (and CI) is unaffected. Requires Stripe Connect to be enabled on your test
// account (Dashboard > Connect). No Stripe CLI or webhook is needed: when the customer returns,
// the confirmation page asks Stripe directly (the same code path the webhook uses). If you do run
// `stripe listen --forward-connect-to localhost:3000/api/webhooks/stripe-connect`, the webhook
// confirms it first and the result is the same.
//
// NOTE: written against Stripe's documented test data and the hosted Checkout page; if Stripe
// changes that page's markup, the selectors in fillCard() are the only place to adjust.
const key = process.env.STRIPE_SECRET_KEY;
test.describe("@stripe real Stripe test-mode deposit", () => {
  test.skip(!key, "Needs STRIPE_SECRET_KEY (a Stripe TEST key) with Connect enabled; see README");
  test.setTimeout(180_000);

  const prisma = createTestPrisma();
  const run = Math.random().toString(36).slice(2, 8);
  const TZ = "America/New_York";
  let stripe: Stripe;
  let accountId: string;
  let S: ShopFixture;
  let nineAm: string;

  test.beforeAll(async () => {
    if (!key!.startsWith("sk_test_") && !key!.startsWith("rk_test_")) throw new Error("Refusing to run: STRIPE_SECRET_KEY is not a test key");
    stripe = new Stripe(key!);

    // A connected account with every capability switched on using Stripe's documented TEST data,
    // standing in for a shop that finished onboarding.
    const account = await stripe.accounts.create({
      type: "custom",
      country: "US",
      email: `e2e-${run}@example.com`,
      business_type: "individual",
      business_profile: { url: "https://example.com", mcc: "7230" },
      capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
      individual: {
        first_name: "Jenny",
        last_name: "Rosen",
        email: `jenny-${run}@example.com`,
        phone: "0000000000",
        dob: { day: 1, month: 1, year: 1901 },
        ssn_last_4: "0000",
        address: { line1: "address_full_match", city: "San Francisco", state: "CA", postal_code: "94103" },
      },
      external_account: { object: "bank_account", country: "US", currency: "usd", routing_number: "110000000", account_number: "000123456789" },
      tos_acceptance: { date: Math.floor(Date.now() / 1000), ip: "127.0.0.1" },
    });
    accountId = account.id;
    for (let i = 0; i < 40; i++) {
      if ((await stripe.accounts.retrieve(accountId)).charges_enabled) break;
      await new Promise((r) => setTimeout(r, 1500));
    }
    expect((await stripe.accounts.retrieve(accountId)).charges_enabled, "test connected account became ready").toBe(true);

    const o = await signUpApi(prisma, run, "stripe-owner");
    const s = await signUpApi(prisma, run, "stripe-staff");
    S = await seedShop(prisma, run, "Z", { owner: o, staffUser: s });
    await openWholeWeek(prisma, S);
    await prisma.tenant.update({ where: { id: S.tenant.id }, data: { stripeAccountId: accountId, chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true } });
    nineAm = localInstant(addDaysToDate(todayIn(TZ, new Date()), 1), 540, TZ).toISOString();
  });

  test.afterAll(async () => {
    await prisma.rateLimit.deleteMany({ where: { key: { startsWith: "pub:" } } });
    await cleanupRun(prisma, run);
    await prisma.$disconnect();
    if (accountId) await stripe.accounts.del(accountId).catch(() => {});
  });

  async function startBooking(page: Page, who: string) {
    await page.goto(`${BASE}/b/${S.tenant.slug}/${S.service.id}/details?staff=${S.ownerStaff.id}&start=${encodeURIComponent(nineAm)}`);
    await byLabel(page, "Your name").fill(who);
    await byLabel(page, "Email").fill(`${who.toLowerCase().replace(/\W+/g, "")}-${run}@example.com`);
    await page.getByRole("button", { name: "Confirm booking" }).click();
    await page.waitForURL(/checkout\.stripe\.com/, { timeout: 45_000 }); // sent to Stripe's hosted payment page
  }

  async function fillCard(page: Page, number: string) {
    await page.getByPlaceholder("1234 1234 1234 1234").fill(number);
    await page.getByPlaceholder("MM / YY").fill("12 / 34");
    await page.getByPlaceholder("CVC").fill("123");
    const name = page.getByPlaceholder("Full name on card");
    if (await name.count()) await name.fill("Test Customer");
    const zip = page.getByPlaceholder("ZIP");
    if (await zip.count()) await zip.fill("94103");
    await page.getByTestId("hosted-payment-submit-button").click();
  }

  test("a customer pays the deposit with 4242 4242 4242 4242: booking confirmed, fee taken, money on the shop's account", async ({ page }) => {
    await startBooking(page, "Casey Card");
    await fillCard(page, "4242 4242 4242 4242");

    // back on our confirmation page, confirmed (via the webhook if it is forwarded, else the return-page check)
    await page.waitForURL(new RegExp(`/b/${S.tenant.slug}/confirmation/`), { timeout: 90_000 });
    await expect(page.getByRole("heading", { name: "You're booked!" })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText("paid online")).toBeVisible();

    const booking = await prisma.booking.findFirstOrThrow({ where: { tenantId: S.tenant.id }, include: { payments: true } });
    expect(booking.status).toBe("CONFIRMED");
    expect(booking.payments).toHaveLength(1);
    const payment = booking.payments[0];
    expect(payment).toMatchObject({ status: "SUCCEEDED", amountCents: 500, applicationFeeCents: 25 }); // 5% of $5.00

    // Stripe agrees: a direct charge on the SHOP's account with our application fee
    const intent = await stripe.paymentIntents.retrieve(payment.stripePaymentIntentId!, undefined, { stripeAccount: accountId });
    expect(intent).toMatchObject({ status: "succeeded", amount: 500, application_fee_amount: 25 });
  });

  test("a declined card leaves the time held and the booking unpaid", async ({ page }) => {
    await prisma.booking.deleteMany({ where: { tenantId: S.tenant.id } });
    await prisma.payment.deleteMany({ where: { tenantId: S.tenant.id } });
    await startBooking(page, "Dee Decline");
    await fillCard(page, "4000 0000 0000 0002"); // Stripe's "card declined" test number
    await expect(page.getByText(/declined/i).first()).toBeVisible({ timeout: 30_000 });
    const booking = await prisma.booking.findFirstOrThrow({ where: { tenantId: S.tenant.id } });
    expect(booking.status).toBe("PENDING_PAYMENT");
  });
});
