import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Stripe's API is replaced by a fake (no network). Everything else is real: the route handlers,
// webhook signature verification (the SDK's own signing), the services and the Postgres database.
const holder = vi.hoisted(() => ({ current: null as any }));
vi.mock("@/lib/stripe", async () => {
  const Stripe = (await import("stripe")).default;
  const verifier = new Stripe("sk_test_signing_only"); // REAL signature verification, just no API calls
  return {
    getStripe: () => holder.current,
    isStripeConfigured: () => true,
    constructWebhookEvent: (body: string, sig: string, secret: string) => verifier.webhooks.constructEvent(body, sig, secret),
  };
});
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));

import { GET as cronGet } from "@/app/api/cron/expire-holds/route";
import { POST as webhookPost } from "@/app/api/webhooks/stripe-connect/route";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import type { TenantContext } from "@/lib/tenant-context";
import * as bookingService from "@/services/booking.service";
import * as paymentService from "@/services/payment.service";
import * as payoutsService from "@/services/payouts.service";
import * as publicBooking from "@/services/public-booking.service";
import { sweepExpiredHolds } from "@/services/booking-expiry.service";
import { createTestPrisma } from "../support/db.mts";
import { cleanupRun, ctxFor, openWholeWeek, seedShop, type ShopFixture } from "../support/fixtures.mts";
import { createStripeFake, paidSession, signedRequest, stripeEvent } from "../support/stripe-fake.mts";

const prisma = createTestPrisma();
const run = Math.random().toString(36).slice(2, 8);
const NOW = new Date("2031-07-01T12:00:00Z"); // Tuesday 08:00 New York
const LATER = new Date("2031-07-01T12:40:00Z"); // well past a 15-minute hold
const SLOT_A = "2031-07-02T14:00:00.000Z"; // Wednesday 10:00 EDT
const SLOT_B = "2031-07-02T15:00:00.000Z";

let S: ShopFixture; // card-ready shop
let O: ShopFixture; // a different card-ready shop
let ownerCtx: TenantContext;
let stripe: ReturnType<typeof createStripeFake>;
let keyN = 0;
const key = () => `pay${run}-${keyN++}`;
const acct = (label: string) => `acct_${run}_${label}`;
const user = (label: string) => prisma.user.create({ data: { email: `${label}-${run}@it.example.com`, name: label } });

async function deposit(over: { staff?: string; startsAt?: string; now?: Date } = {}) {
  const r = await publicBooking.createBooking(
    { tenantSlug: S.tenant.slug, serviceId: S.service.id, staff: over.staff ?? S.ownerStaff.id, startsAt: over.startsAt ?? SLOT_A, name: "Pat Payer", email: `pat-${key()}@it.example.com`, website: "" },
    { clientKey: key(), now: over.now ?? NOW },
  );
  const booking = await prisma.booking.findFirstOrThrow({ where: { publicToken: r.publicToken } });
  return { ...r, id: booking.id };
}
const checkout = (token: string, now = NOW) => paymentService.startDepositCheckout(S.tenant.slug, token, now);
const sessionFor = async (bookingId: string) => (await prisma.payment.findMany({ where: { bookingId }, orderBy: { createdAt: "asc" } })).at(-1)!;
const booking = (id: string) => prisma.booking.findUniqueOrThrow({ where: { id } });
const payments = (bookingId: string) => prisma.payment.findMany({ where: { bookingId }, orderBy: { createdAt: "asc" } });
const deliver = (evt: unknown, opts?: Parameters<typeof signedRequest>[1]) => webhookPost(signedRequest(evt, opts));
const body = async (r: Response) => (await r.json()) as { outcome?: string; error?: string };

async function reset() {
  stripe = createStripeFake();
  holder.current = stripe.fake;
  await prisma.payment.deleteMany({ where: { tenantId: { in: [S.tenant.id, O.tenant.id] } } });
  await prisma.booking.deleteMany({ where: { tenantId: { in: [S.tenant.id, O.tenant.id] } } });
  await prisma.webhookEvent.deleteMany({ where: { id: { startsWith: "evt_test_" } } });
  await prisma.tenant.update({ where: { id: S.tenant.id }, data: { chargesEnabled: true, stripeAccountId: acct("S"), depositHoldMinutes: 15, detailsSubmitted: true, payoutsEnabled: true, stripeRequirementsDue: [] } });
}

beforeAll(async () => {
  S = await seedShop(prisma, run, "S", { owner: await user("s-owner"), staffUser: await user("s-staff") });
  O = await seedShop(prisma, run, "O", { owner: await user("o-owner"), staffUser: await user("o-staff") });
  await openWholeWeek(prisma, S);
  await openWholeWeek(prisma, O);
  await prisma.tenant.update({ where: { id: O.tenant.id }, data: { chargesEnabled: true, stripeAccountId: acct("O") } });
  ownerCtx = await ctxFor(prisma, S, "owner");
});
beforeEach(reset);
afterAll(async () => {
  await prisma.webhookEvent.deleteMany({ where: { id: { startsWith: "evt_test_" } } });
  await prisma.rateLimit.deleteMany({ where: { key: { startsWith: "pub:" } } });
  await cleanupRun(prisma, run);
  await prisma.$disconnect();
});

describe("starting a deposit payment", () => {
  it("creates a Checkout Session on the SHOP's connected account with the platform fee, not on ours", async () => {
    const b = await deposit();
    expect(b.status).toBe("PENDING_PAYMENT");
    const { url } = await checkout(b.publicToken);
    expect(url).toMatch(/^https:\/\/checkout\.stripe\.test\/cs_test_/);

    const [call] = stripe.callsTo("checkout.sessions.create");
    expect(call.options.stripeAccount).toBe(acct("S")); // direct charge: created ON the connected account
    expect(call.params).toMatchObject({
      mode: "payment",
      customer_email: expect.stringContaining("@it.example.com"),
      client_reference_id: b.id,
      metadata: { bookingId: b.id, tenantId: S.tenant.id },
      payment_intent_data: { application_fee_amount: 25, metadata: { bookingId: b.id } }, // 5% of $5.00
      success_url: `http://localhost:3000/b/${S.tenant.slug}/confirmation/${b.publicToken}?paid=1`,
      cancel_url: `http://localhost:3000/b/${S.tenant.slug}/confirmation/${b.publicToken}?canceled=1`,
    });
    expect(call.params.line_items[0].price_data).toMatchObject({ currency: "usd", unit_amount: 500 });
    // Stripe requires 30+ minutes; ours is a little more.
    expect(call.params.expires_at - Math.floor(NOW.getTime() / 1000)).toBeGreaterThanOrEqual(30 * 60);
    expect(call.options.idempotencyKey).toBe(`checkout_${b.id}_0`);
  });

  it("records a PENDING payment with the amount and the platform's fee", async () => {
    const b = await deposit();
    await checkout(b.publicToken);
    const [p] = await payments(b.id);
    expect(p).toMatchObject({ status: "PENDING", amountCents: 500, applicationFeeCents: 25, currency: "usd", tenantId: S.tenant.id });
  });

  it("reuses the customer's open session instead of creating another", async () => {
    const b = await deposit();
    const first = await checkout(b.publicToken);
    const second = await checkout(b.publicToken);
    expect(second.url).toBe(first.url);
    expect(stripe.callsTo("checkout.sessions.create")).toHaveLength(1);
    expect(await payments(b.id)).toHaveLength(1);
  });

  it("creates a fresh session (new idempotency key) once the old one is no longer open", async () => {
    const b = await deposit();
    await checkout(b.publicToken);
    [...stripe.sessions.values()][0].status = "expired";
    await checkout(b.publicToken);
    expect(stripe.callsTo("checkout.sessions.create").map((c) => c.options.idempotencyKey)).toEqual([`checkout_${b.id}_0`, `checkout_${b.id}_1`]);
    expect(await payments(b.id)).toHaveLength(2);
  });

  it("refuses when payment isn't possible: not pending, hold expired, shop not card-ready, unknown or foreign token", async () => {
    const b = await deposit();
    await expect(checkout(b.publicToken, LATER)).rejects.toMatchObject({ code: "HOLD_EXPIRED" });

    await prisma.tenant.update({ where: { id: S.tenant.id }, data: { chargesEnabled: false } });
    await expect(checkout(b.publicToken)).rejects.toMatchObject({ code: "PAYMENTS_UNAVAILABLE" });
    await prisma.tenant.update({ where: { id: S.tenant.id }, data: { chargesEnabled: true } });

    await prisma.booking.update({ where: { id: b.id }, data: { status: "CONFIRMED" } });
    await expect(checkout(b.publicToken)).rejects.toMatchObject({ code: "NOT_PENDING" });

    await expect(checkout("no-such-token")).rejects.toBeInstanceOf(NotFoundError);
    await expect(paymentService.startDepositCheckout(O.tenant.slug, b.publicToken, NOW)).rejects.toBeInstanceOf(NotFoundError); // another shop can't pay for it
    expect(stripe.callsTo("checkout.sessions.create")).toHaveLength(0);
  });
});

describe("webhook authenticity", () => {
  it("rejects a missing, forged, tampered or wrong-secret signature (400) and changes nothing", async () => {
    const b = await deposit();
    await checkout(b.publicToken);
    const s = await sessionFor(b.id);
    const evt = stripeEvent("checkout.session.completed", paidSession({ id: s.stripeCheckoutSessionId, bookingId: b.id, amount: 500 }), { account: acct("S") });

    for (const [why, opts] of [
      ["no signature header", { header: null }],
      ["garbage signature", { header: "t=1,v1=deadbeef" }],
      ["wrong secret", { secret: "whsec_someone_else" }],
      ["body altered after signing", { tamper: true }],
    ] as const) {
      const r = await deliver(evt, opts);
      expect(r.status, why).toBe(400);
    }
    expect((await booking(b.id)).status).toBe("PENDING_PAYMENT");
    expect(await prisma.webhookEvent.count({ where: { id: evt.id } })).toBe(0); // nothing was even recorded
  });
});

describe("a successful payment", () => {
  it("confirms the booking, records the payment and the payment intent", async () => {
    const b = await deposit();
    await checkout(b.publicToken);
    const s = await sessionFor(b.id);
    const evt = stripeEvent("checkout.session.completed", paidSession({ id: s.stripeCheckoutSessionId, bookingId: b.id, amount: 500, paymentIntent: "pi_test_one" }), { account: acct("S") });

    const r = await deliver(evt);
    expect(r.status).toBe(200);
    expect(await body(r)).toMatchObject({ outcome: "processed" });

    expect(await booking(b.id)).toMatchObject({ status: "CONFIRMED", holdExpiresAt: null });
    expect((await payments(b.id))[0]).toMatchObject({ status: "SUCCEEDED", stripePaymentIntentId: "pi_test_one", applicationFeeCents: 25 });
    const ledger = await prisma.webhookEvent.findUniqueOrThrow({ where: { id: evt.id } });
    expect(ledger.processedAt).not.toBeNull();
    expect(JSON.stringify(ledger.payload)).not.toContain("@"); // the ledger keeps ids, never customer details
    expect(stripe.callsTo("refunds.create")).toHaveLength(0);
  });

  it("is idempotent: the same event delivered again does nothing", async () => {
    const b = await deposit();
    await checkout(b.publicToken);
    const s = await sessionFor(b.id);
    const evt = stripeEvent("checkout.session.completed", paidSession({ id: s.stripeCheckoutSessionId, bookingId: b.id, amount: 500 }), { account: acct("S") });
    expect((await body(await deliver(evt))).outcome).toBe("processed");
    for (let i = 0; i < 3; i++) expect((await body(await deliver(evt))).outcome).toBe("duplicate");
    expect(await prisma.webhookEvent.count({ where: { id: evt.id } })).toBe(1);
    expect(await payments(b.id)).toHaveLength(1);
  });

  it("is idempotent under CONCURRENT duplicate deliveries: exactly one applies", async () => {
    const b = await deposit();
    await checkout(b.publicToken);
    const s = await sessionFor(b.id);
    // refund path makes duplicates observable: if two copies ran, two refunds would be requested
    await prisma.booking.update({ where: { id: b.id }, data: { status: "CANCELLED", cancelReason: "shop" } });
    const evt = stripeEvent("checkout.session.completed", paidSession({ id: s.stripeCheckoutSessionId, bookingId: b.id, amount: 500 }), { account: acct("S") });

    const results = await Promise.all(Array.from({ length: 6 }, () => deliver(evt)));
    expect(results.every((r) => r.status === 200)).toBe(true);
    const outcomes = await Promise.all(results.map(async (r) => (await body(r)).outcome));
    expect(outcomes.filter((o) => o === "processed")).toHaveLength(1);
    expect(outcomes.filter((o) => o === "duplicate")).toHaveLength(5);
    expect(stripe.callsTo("refunds.create")).toHaveLength(1);
    expect(await prisma.webhookEvent.count({ where: { id: evt.id } })).toBe(1);
  });

  it("an event for ANOTHER shop's connected account can't confirm this shop's booking", async () => {
    const b = await deposit();
    await checkout(b.publicToken);
    const s = await sessionFor(b.id);
    const evt = stripeEvent("checkout.session.completed", paidSession({ id: s.stripeCheckoutSessionId, bookingId: b.id, amount: 500 }), { account: acct("O") });
    const r = await deliver(evt);
    expect(r.status).toBe(200);
    expect((await booking(b.id)).status).toBe("PENDING_PAYMENT"); // shop O has no such booking, so nothing happened
    expect((await payments(b.id))[0].status).toBe("PENDING");
  });

  it("acknowledges events for unknown accounts, platform-level events and unrelated types without touching anything", async () => {
    const b = await deposit();
    for (const evt of [
      stripeEvent("checkout.session.completed", paidSession({ id: "cs_x", bookingId: b.id, amount: 500 }), { account: "acct_not_ours" }),
      stripeEvent("checkout.session.completed", paidSession({ id: "cs_y", bookingId: b.id, amount: 500 })), // no account at all
      stripeEvent("customer.created", { id: "cus_1" }, { account: acct("S") }),
    ]) {
      const r = await deliver(evt);
      expect(r.status).toBe(200);
      expect((await body(r)).outcome).toBe("ignored");
    }
    expect((await booking(b.id)).status).toBe("PENDING_PAYMENT");
  });

  it("refuses to confirm when Stripe's amount differs from ours, and Stripe is told to retry (500)", async () => {
    const b = await deposit();
    await checkout(b.publicToken);
    const s = await sessionFor(b.id);
    const evt = stripeEvent("checkout.session.completed", paidSession({ id: s.stripeCheckoutSessionId, bookingId: b.id, amount: 100 }), { account: acct("S") });
    expect((await deliver(evt)).status).toBe(500);
    expect((await booking(b.id)).status).toBe("PENDING_PAYMENT");
    expect((await payments(b.id))[0].status).toBe("PENDING");
    const ledger = await prisma.webhookEvent.findUniqueOrThrow({ where: { id: evt.id } });
    expect(ledger.error).toContain("Amount mismatch");
    expect(ledger.processedAt).toBeNull();
  });

  it("rebuilds the payment record if the app crashed before saving it (session metadata identifies the booking)", async () => {
    const b = await deposit();
    const evt = stripeEvent("checkout.session.completed", paidSession({ id: "cs_orphan_" + run, bookingId: b.id, amount: 500 }), { account: acct("S") });
    expect((await deliver(evt)).status).toBe(200);
    expect((await booking(b.id)).status).toBe("CONFIRMED");
    expect((await payments(b.id))[0]).toMatchObject({ stripeCheckoutSessionId: "cs_orphan_" + run, status: "SUCCEEDED", applicationFeeCents: 25 });
  });
});

describe("paying AFTER the hold lapsed (Stripe sessions outlive our 15-minute hold)", () => {
  async function lapsed() {
    const b = await deposit();
    await checkout(b.publicToken);
    const s = await sessionFor(b.id);
    await sweepExpiredHolds(LATER); // the scheduled job cancels the stale hold
    expect(await booking(b.id)).toMatchObject({ status: "CANCELLED", cancelReason: "hold_expired" });
    const evt = stripeEvent("checkout.session.completed", paidSession({ id: s.stripeCheckoutSessionId, bookingId: b.id, amount: 500, paymentIntent: "pi_late" }), { account: acct("S") });
    return { b, s, evt };
  }

  it("slot still free: the booking is REVIVED and confirmed, no refund", async () => {
    const { b, evt } = await lapsed();
    expect((await deliver(evt)).status).toBe(200);
    expect(await booking(b.id)).toMatchObject({ status: "CONFIRMED", cancelReason: null, cancelledAt: null, holdExpiresAt: null });
    expect((await payments(b.id))[0].status).toBe("SUCCEEDED");
    expect(stripe.callsTo("refunds.create")).toHaveLength(0);
  });

  it("slot taken by someone else meanwhile: the payment is REFUNDED (with the platform fee) and the other booking is untouched", async () => {
    const { b, evt } = await lapsed();
    const other = await deposit({ now: LATER }); // the freed slot is booked by another customer
    expect(other.status).toBe("PENDING_PAYMENT");

    expect((await deliver(evt)).status).toBe(200);
    expect((await booking(b.id)).status).toBe("CANCELLED");
    expect((await payments(b.id))[0].status).toBe("REFUNDED");
    expect((await booking(other.id)).status).toBe("PENDING_PAYMENT");

    const [refund] = stripe.callsTo("refunds.create");
    expect(refund.params).toEqual({ payment_intent: "pi_late", refund_application_fee: true });
    expect(refund.options).toMatchObject({ stripeAccount: acct("S") });
    expect(refund.options.idempotencyKey).toMatch(/^refund_/);
  });

  it("the shop cancelled the booking, then the customer paid anyway: refunded", async () => {
    const b = await deposit();
    await checkout(b.publicToken);
    const s = await sessionFor(b.id);
    await bookingService.setBookingStatus(ownerCtx, b.id, "CANCELLED", NOW);
    const evt = stripeEvent("checkout.session.completed", paidSession({ id: s.stripeCheckoutSessionId, bookingId: b.id, amount: 500 }), { account: acct("S") });
    expect((await deliver(evt)).status).toBe(200);
    expect((await booking(b.id)).status).toBe("CANCELLED");
    expect((await payments(b.id))[0].status).toBe("REFUNDED");
    expect(stripe.callsTo("refunds.create")).toHaveLength(1);
  });

  it("a SECOND payment for the same booking (two tabs) is refunded; the first stands", async () => {
    const b = await deposit();
    await checkout(b.publicToken);
    const first = await sessionFor(b.id);
    [...stripe.sessions.values()][0].status = "expired"; // forces a second session to be created
    await checkout(b.publicToken);
    const second = await sessionFor(b.id);
    expect(second.id).not.toBe(first.id);

    await deliver(stripeEvent("checkout.session.completed", paidSession({ id: second.stripeCheckoutSessionId, bookingId: b.id, amount: 500, paymentIntent: "pi_second" }), { account: acct("S") }));
    await deliver(stripeEvent("checkout.session.completed", paidSession({ id: first.stripeCheckoutSessionId, bookingId: b.id, amount: 500, paymentIntent: "pi_first" }), { account: acct("S") }));

    expect((await booking(b.id)).status).toBe("CONFIRMED");
    const byId = Object.fromEntries((await payments(b.id)).map((p) => [p.id, p.status]));
    expect(byId[second.id]).toBe("SUCCEEDED");
    expect(byId[first.id]).toBe("REFUNDED");
    expect(stripe.callsTo("refunds.create").map((c) => c.params.payment_intent)).toEqual(["pi_first"]);
  });

  it("if the refund call fails, nothing is half-applied, the event is retried, and the retry succeeds exactly once", async () => {
    const { b, evt } = await lapsed();
    await deposit({ now: LATER }); // slot re-taken, so a refund is required
    stripe.state.failRefunds = true;

    const failed = await deliver(evt);
    expect(failed.status).toBe(500); // Stripe will retry
    expect((await payments(b.id))[0].status).toBe("PENDING"); // rolled back: not "succeeded without a refund"
    const ledger = await prisma.webhookEvent.findUniqueOrThrow({ where: { id: evt.id } });
    expect(ledger.processedAt).toBeNull();
    expect(ledger.error).toContain("Stripe is down");

    stripe.state.failRefunds = false;
    const retry = await deliver(evt); // Stripe's retry
    expect(retry.status).toBe(200);
    expect((await body(retry)).outcome).toBe("processed");
    expect((await payments(b.id))[0].status).toBe("REFUNDED");
    expect((await prisma.webhookEvent.findUniqueOrThrow({ where: { id: evt.id } })).processedAt).not.toBeNull();
    expect((await deliver(evt)).status).toBe(200); // and a further replay is a harmless duplicate
    expect(stripe.callsTo("refunds.create").filter((c) => !c.options?.failed)).toHaveLength(2); // one failed attempt + one real; same idempotency key
    expect(new Set(stripe.callsTo("refunds.create").map((c) => c.options.idempotencyKey)).size).toBe(1);
  });
});

describe("abandoned and failed payments", () => {
  it("checkout.session.expired releases the slot and marks the payment failed", async () => {
    const b = await deposit();
    await checkout(b.publicToken);
    const s = await sessionFor(b.id);
    const evt = stripeEvent("checkout.session.expired", { id: s.stripeCheckoutSessionId, object: "checkout.session", status: "expired", metadata: { bookingId: b.id } }, { account: acct("S") });
    expect((await deliver(evt)).status).toBe(200);
    expect(await booking(b.id)).toMatchObject({ status: "CANCELLED", cancelReason: "payment_expired" });
    expect((await payments(b.id))[0]).toMatchObject({ status: "FAILED", failureReason: "checkout_expired" });

    const a = await publicBooking.getAvailability(S.tenant.slug, S.service.id, S.ownerStaff.id, "2031-07-02", NOW);
    expect(a.days[0].slots.map((x) => x.startsAt)).toContain(SLOT_A); // bookable again
  });

  it("an expired OLD session does not cancel a booking whose newer session is still open", async () => {
    const b = await deposit();
    await checkout(b.publicToken);
    const first = await sessionFor(b.id);
    [...stripe.sessions.values()][0].status = "expired";
    await checkout(b.publicToken); // second session, still open
    await deliver(stripeEvent("checkout.session.expired", { id: first.stripeCheckoutSessionId, object: "checkout.session", metadata: { bookingId: b.id } }, { account: acct("S") }));
    expect((await booking(b.id)).status).toBe("PENDING_PAYMENT");
  });

  it("a failed card attempt records why but keeps the hold (the customer can try another card)", async () => {
    const b = await deposit();
    await checkout(b.publicToken);
    const evt = stripeEvent("payment_intent.payment_failed", { id: "pi_bad", object: "payment_intent", metadata: { bookingId: b.id }, last_payment_error: { message: "Your card was declined.", code: "card_declined" } }, { account: acct("S") });
    expect((await deliver(evt)).status).toBe(200);
    expect((await payments(b.id))[0]).toMatchObject({ status: "PENDING", failureReason: "Your card was declined." });
    expect((await booking(b.id)).status).toBe("PENDING_PAYMENT");
  });
});

describe("the return page's safety net (reconcile)", () => {
  it("confirms a paid booking even if the webhook hasn't arrived, and the webhook arriving later changes nothing", async () => {
    const b = await deposit();
    await checkout(b.publicToken);
    const s = await sessionFor(b.id);

    await paymentService.reconcileBooking(S.tenant.slug, b.publicToken);
    expect((await booking(b.id)).status).toBe("PENDING_PAYMENT"); // Stripe says unpaid: nothing happens

    Object.assign(stripe.sessions.get(s.stripeCheckoutSessionId), { status: "complete", payment_status: "paid", payment_intent: "pi_recon" });
    await paymentService.reconcileBooking(S.tenant.slug, b.publicToken);
    expect(await booking(b.id)).toMatchObject({ status: "CONFIRMED" });
    expect((await payments(b.id))[0]).toMatchObject({ status: "SUCCEEDED", stripePaymentIntentId: "pi_recon" });

    const late = await deliver(stripeEvent("checkout.session.completed", paidSession({ id: s.stripeCheckoutSessionId, bookingId: b.id, amount: 500, paymentIntent: "pi_recon" }), { account: acct("S") }));
    expect(late.status).toBe(200);
    expect(stripe.callsTo("refunds.create")).toHaveLength(0);
    expect(await payments(b.id)).toHaveLength(1);
  });
});

describe("the confirmation page's view of a booking", () => {
  it("says whether the customer can still pay, and whether they already did", async () => {
    const b = await deposit();
    expect((await publicBooking.getConfirmation(S.tenant.slug, b.publicToken, NOW)).booking).toMatchObject({ status: "PENDING_PAYMENT", payable: true, depositPaidOnline: false });
    expect((await publicBooking.getConfirmation(S.tenant.slug, b.publicToken, LATER)).booking.payable).toBe(false); // hold lapsed

    await checkout(b.publicToken);
    const s = await sessionFor(b.id);
    await deliver(stripeEvent("checkout.session.completed", paidSession({ id: s.stripeCheckoutSessionId, bookingId: b.id, amount: 500 }), { account: acct("S") }));
    expect((await publicBooking.getConfirmation(S.tenant.slug, b.publicToken, NOW)).booking).toMatchObject({ status: "CONFIRMED", payable: false, depositPaidOnline: true });
  });
});

describe("scheduled hold expiry (cron)", () => {
  const call = (secret?: string) => cronGet(new Request("http://localhost:3000/api/cron/expire-holds", { headers: secret ? { authorization: `Bearer ${secret}` } : {} }));

  it("refuses callers without the right secret", async () => {
    expect((await call()).status).toBe(401);
    expect((await call("wrong")).status).toBe(401);
    expect((await call("cron-secret-for-tests-but-longer")).status).toBe(401);
  });

  it("cancels only expired holds, closes their Stripe sessions, and leaves everything else alone", async () => {
    const stale = await deposit({ startsAt: SLOT_A }); // hold ends 12:15 (2031)
    await checkout(stale.publicToken);
    const confirmed = await deposit({ startsAt: SLOT_B });
    await prisma.booking.update({ where: { id: confirmed.id }, data: { status: "CONFIRMED", holdExpiresAt: null } });
    const fresh = await deposit({ startsAt: "2031-07-02T16:00:00.000Z" });
    // make "fresh" unexpired relative to the real clock the route uses (now ~ real time, 2026+)
    await prisma.booking.update({ where: { id: fresh.id }, data: { holdExpiresAt: new Date(Date.now() + 3_600_000) } });
    await prisma.booking.update({ where: { id: stale.id }, data: { holdExpiresAt: new Date(Date.now() - 60_000) } });

    const r = await call("cron-secret-for-tests");
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ holdsCancelled: 1, sessionsExpired: 1 });
    expect(await booking(stale.id)).toMatchObject({ status: "CANCELLED", cancelReason: "hold_expired" });
    expect((await booking(confirmed.id)).status).toBe("CONFIRMED");
    expect((await booking(fresh.id)).status).toBe("PENDING_PAYMENT");
    expect(stripe.callsTo("checkout.sessions.expire")[0].options).toMatchObject({ stripeAccount: acct("S") });

    expect(await (await call("cron-secret-for-tests")).json()).toMatchObject({ holdsCancelled: 0, sessionsExpired: 0 }); // idempotent
  });
});

describe("account status webhooks", () => {
  it("account.updated mirrors Stripe's state onto the shop, which flips online deposits on and off", async () => {
    await prisma.tenant.update({ where: { id: S.tenant.id }, data: { chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: false } });
    const incomplete = stripeEvent("account.updated", { id: acct("S"), object: "account", charges_enabled: false, payouts_enabled: false, details_submitted: true, requirements: { currently_due: ["external_account"] } }, { account: acct("S") });
    expect((await deliver(incomplete)).status).toBe(200);
    expect(await prisma.tenant.findUniqueOrThrow({ where: { id: S.tenant.id } })).toMatchObject({ chargesEnabled: false, detailsSubmitted: true, stripeRequirementsDue: ["external_account"] });
    expect((await publicBooking.getShop(S.tenant.slug)).shop.depositOnline).toBe(false);

    const ready = stripeEvent("account.updated", { id: acct("S"), object: "account", charges_enabled: true, payouts_enabled: true, details_submitted: true, requirements: { currently_due: [] } }, { account: acct("S") });
    expect((await deliver(ready)).status).toBe(200);
    expect(await prisma.tenant.findUniqueOrThrow({ where: { id: S.tenant.id } })).toMatchObject({ chargesEnabled: true, payoutsEnabled: true, stripeRequirementsDue: [] });
    expect((await publicBooking.getShop(S.tenant.slug)).shop.depositOnline).toBe(true);
  });

  it("an account.updated whose object isn't the event's account is ignored", async () => {
    const evt = stripeEvent("account.updated", { id: acct("O"), object: "account", charges_enabled: false, payouts_enabled: false, details_submitted: false, requirements: { currently_due: [] } }, { account: acct("S") });
    expect((await body(await deliver(evt))).outcome).toBe("ignored");
    expect((await prisma.tenant.findUniqueOrThrow({ where: { id: S.tenant.id } })).chargesEnabled).toBe(true);
  });
});

describe("payouts onboarding (Stripe Connect Express)", () => {
  let P: ShopFixture;
  const fresh = async (label: string) => {
    const shop = await seedShop(prisma, run, label, { owner: await user(`${label.toLowerCase()}-owner`), staffUser: await user(`${label.toLowerCase()}-staff`) });
    await prisma.tenant.update({ where: { id: shop.tenant.id }, data: { stripeAccountId: null, chargesEnabled: false, detailsSubmitted: false } });
    return shop;
  };
  const ctxOf = async (shop: ShopFixture, who: "owner" | "staff" = "owner") => ({ ...(await ctxFor(prisma, shop, who)) });

  beforeAll(async () => {
    P = await fresh("P");
  });

  it("creates ONE Express account for the shop and returns a Stripe-hosted onboarding link", async () => {
    await prisma.tenant.update({ where: { id: P.tenant.id }, data: { stripeAccountId: null } });
    const ctx = await ctxOf(P);
    const { url } = await payoutsService.startOnboarding(ctx);

    const [create] = stripe.callsTo("accounts.create");
    expect(create.params).toMatchObject({
      type: "express",
      country: "US",
      email: P.owner.email,
      capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
      metadata: { tenantId: P.tenant.id },
    });
    expect(create.options.idempotencyKey).toBe(`connect_account_${P.tenant.id}`);
    const stored = (await prisma.tenant.findUniqueOrThrow({ where: { id: P.tenant.id } })).stripeAccountId!;
    expect(url).toBe(`https://connect.stripe.test/setup/${stored}`);
    expect(stripe.callsTo("accountLinks.create")[0].params).toMatchObject({
      type: "account_onboarding",
      refresh_url: "http://localhost:3000/dashboard/payouts/refresh",
      return_url: "http://localhost:3000/dashboard/payouts/return",
    });

    // calling again (the shop now has an account) creates no second account
    await payoutsService.startOnboarding(await ctxOf(P));
    expect(stripe.callsTo("accounts.create")).toHaveLength(1);
    expect(stripe.callsTo("accountLinks.create")).toHaveLength(2);
  });

  it("many simultaneous clicks still end with exactly one account on the shop", async () => {
    const Q = await fresh("Q");
    const stale = await ctxOf(Q); // every click sees "no account yet"
    const urls = await Promise.all(Array.from({ length: 5 }, () => payoutsService.startOnboarding(stale)));
    const stored = (await prisma.tenant.findUniqueOrThrow({ where: { id: Q.tenant.id } })).stripeAccountId!;
    expect(new Set(urls.map((u) => u.url))).toEqual(new Set([`https://connect.stripe.test/setup/${stored}`]));
    expect(new Set(stripe.callsTo("accounts.create").map((c) => c.options.idempotencyKey)).size).toBe(1);
  });

  it("each shop gets its own account", async () => {
    const A1 = await fresh("R");
    const A2 = await fresh("T");
    await payoutsService.startOnboarding(await ctxOf(A1));
    await payoutsService.startOnboarding(await ctxOf(A2));
    const [t1, t2] = await Promise.all([A1, A2].map((s) => prisma.tenant.findUniqueOrThrow({ where: { id: s.tenant.id } })));
    expect(t1.stripeAccountId).toBeTruthy();
    expect(t1.stripeAccountId).not.toBe(t2.stripeAccountId);
  });

  it("after returning from Stripe, the status is re-read from Stripe (returning does not mean 'done')", async () => {
    const ctx = await ctxOf(P);
    const accountId = ctx.tenant.stripeAccountId ?? (await prisma.tenant.findUniqueOrThrow({ where: { id: P.tenant.id } })).stripeAccountId!;
    stripe.accounts.set(accountId, { id: accountId, charges_enabled: true, payouts_enabled: true, details_submitted: true, requirements: { currently_due: [] } });
    await payoutsService.refreshStatus(await ctxOf(P));
    expect(await prisma.tenant.findUniqueOrThrow({ where: { id: P.tenant.id } })).toMatchObject({ chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true });
    expect(await payoutsService.getPayoutStatus(await ctxOf(P))).toMatchObject({ connected: true, chargesEnabled: true, requirementsDue: [] });
  });

  it("the Stripe dashboard link needs finished onboarding", async () => {
    const U = await fresh("U");
    await prisma.tenant.update({ where: { id: U.tenant.id }, data: { stripeAccountId: "acct_u_" + run, detailsSubmitted: false } });
    await expect(payoutsService.createDashboardLink(await ctxOf(U))).rejects.toBeInstanceOf(ConflictError);
    await prisma.tenant.update({ where: { id: U.tenant.id }, data: { detailsSubmitted: true } });
    expect((await payoutsService.createDashboardLink(await ctxOf(U))).url).toContain("dashboard.stripe.test");
  });

  it("STAFF can't touch payouts at all", async () => {
    const staff = await ctxOf(S, "staff");
    await expect(payoutsService.startOnboarding({ ...staff, user: { email: "x@y.z" } })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(payoutsService.getPayoutStatus(staff)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(payoutsService.refreshStatus(staff)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(payoutsService.createDashboardLink(staff)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
