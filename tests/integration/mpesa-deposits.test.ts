import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Safaricom is replaced by a fake (no network). Everything else is real: the callback route and its URL
// secret, callback parsing, settlement, the services and the Postgres database.
const holder = vi.hoisted(() => ({ current: null as null | ReturnType<typeof import("../support/mpesa-fake.mts").createMpesaFake> }));
vi.mock("@/lib/mpesa", async () => (await import("../support/mpesa-fake.mts")).mpesaModuleMock(holder));
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));

import { GET as cronGet } from "@/app/api/cron/expire-holds/route";
import { POST as callbackPost } from "@/app/api/webhooks/mpesa/[secret]/route";
import { MpesaError, NotFoundError, ValidationError } from "@/lib/errors";
import type { TenantContext } from "@/lib/tenant-context";
import * as bookingRepo from "@/repositories/booking.repo";
import * as bookingService from "@/services/booking.service";
import * as mpesaSettlement from "@/services/mpesa-settlement.service";
import * as paymentService from "@/services/payment.service";
import * as publicBooking from "@/services/public-booking.service";
import { createTestPrisma } from "../support/db.mts";
import { cleanupRun, ctxFor, openWholeWeek, seedShop, type ShopFixture } from "../support/fixtures.mts";
import { CALLBACK_SECRET, callbackBody, callbackRequest, createMpesaFake } from "../support/mpesa-fake.mts";

const prisma = createTestPrisma();
const run = Math.random().toString(36).slice(2, 8);
const NOW = new Date("2031-07-01T12:00:00Z"); // Tuesday 08:00 New York; the hold lasts until 12:15
const LATER = new Date("2031-07-01T12:40:00Z"); // well past a 15-minute hold
const SLOT_A = "2031-07-02T14:00:00.000Z";
const SLOT_B = "2031-07-02T15:00:00.000Z";
const PHONE = "254712345678";

let S: ShopFixture;
let O: ShopFixture;
let ownerCtx: TenantContext;
let mpesa: ReturnType<typeof createMpesaFake>;
let keyN = 0;
const key = () => `dep${run}-${keyN++}`;
const user = (label: string) => prisma.user.create({ data: { email: `${label}-${run}@it.example.com`, name: label } });

async function pendingBooking(over: { staff?: string; startsAt?: string; now?: Date } = {}) {
  const r = await publicBooking.createBooking(
    { tenantSlug: S.tenant.slug, serviceId: S.service.id, staff: over.staff ?? S.ownerStaff.id, startsAt: over.startsAt ?? SLOT_A, name: "Pat Payer", email: `pat-${key()}@it.example.com`, phone: PHONE, website: "" },
    { clientKey: key(), now: over.now ?? NOW },
  );
  const booking = await prisma.booking.findFirstOrThrow({ where: { publicToken: r.publicToken } });
  return { ...r, id: booking.id };
}
const prompt = (token: string, phone = "0712 345 678", now = NOW) => paymentService.startDepositPayment(S.tenant.slug, token, phone, now);
const paymentsOf = (bookingId: string) => prisma.payment.findMany({ where: { bookingId }, orderBy: { createdAt: "asc" } });
const booking = (id: string) => prisma.booking.findUniqueOrThrow({ where: { id } });
const deliver = (body: unknown, secret = CALLBACK_SECRET) => callbackPost(callbackRequest(body, secret), { params: Promise.resolve({ secret }) } as never);
const outcomeOf = async (r: Response) => ((await r.json()) as { outcome?: string }).outcome;

/** The customer approves on their phone: Safaricom's status query says success, then its callback arrives. */
async function approve(push: { checkoutRequestId: string; amountCents: number; phone: string }, receipt = `RCP${Math.random().toString(36).slice(2, 8).toUpperCase()}`) {
  mpesa.approve(push.checkoutRequestId);
  return deliver(callbackBody({ checkoutRequestId: push.checkoutRequestId, amountCents: push.amountCents, phone: push.phone, receipt }));
}

async function reset() {
  mpesa = createMpesaFake();
  holder.current = mpesa;
  await prisma.payment.deleteMany({ where: { tenantId: { in: [S.tenant.id, O.tenant.id] } } });
  await prisma.booking.deleteMany({ where: { tenantId: { in: [S.tenant.id, O.tenant.id] } } });
  await prisma.webhookEvent.deleteMany({ where: { source: "mpesa" } });
  await prisma.tenant.update({ where: { id: S.tenant.id }, data: { payoutPhone: "254722000111", depositHoldMinutes: 15, plan: "PRO" } });
}

beforeAll(async () => {
  S = await seedShop(prisma, run, "S", { owner: await user("s-owner"), staffUser: await user("s-staff") });
  O = await seedShop(prisma, run, "O", { owner: await user("o-owner"), staffUser: await user("o-staff") });
  await openWholeWeek(prisma, S);
  await openWholeWeek(prisma, O);
  ownerCtx = await ctxFor(prisma, S, "owner");
});
beforeEach(reset);
afterAll(async () => {
  await prisma.webhookEvent.deleteMany({ where: { source: "mpesa" } });
  await prisma.rateLimit.deleteMany({ where: { key: { startsWith: "pub:" } } });
  await cleanupRun(prisma, run);
  await prisma.$disconnect();
});

describe("sending the M-Pesa prompt", () => {
  it("asks Safaricom to prompt the customer's phone for the deposit and records a PENDING payment with the platform's fee", async () => {
    const b = await pendingBooking();
    expect(b.status).toBe("PENDING_PAYMENT");
    const r = await prompt(b.publicToken, "0712 345 678");

    const push = mpesa.last();
    expect(push).toMatchObject({ amountCents: 500, phone: PHONE, description: "Deposit" }); // "0712 345 678" normalised
    expect(push.accountReference).toMatch(/^OC[A-Z0-9]{8}$/);
    expect(r.maskedPhone).toBe("07•• ••• 678"); // never echo the full number back

    const [p] = await paymentsOf(b.id);
    expect(p).toMatchObject({ status: "PENDING", tenantId: S.tenant.id, phone: PHONE, amountCents: 500, applicationFeeCents: 25, currency: "kes", checkoutRequestId: push.checkoutRequestId, mpesaReceipt: null });
  });

  it("refuses when a prompt can't or shouldn't be sent, and never calls Safaricom", async () => {
    const b = await pendingBooking();
    await expect(prompt(b.publicToken, "12345")).rejects.toBeInstanceOf(ValidationError); // not a Kenyan number
    await expect(prompt(b.publicToken, "0712345678", LATER)).rejects.toMatchObject({ code: "HOLD_EXPIRED" });
    await expect(prompt("no-such-token")).rejects.toBeInstanceOf(NotFoundError);
    await expect(paymentService.startDepositPayment(O.tenant.slug, b.publicToken, PHONE, NOW)).rejects.toBeInstanceOf(NotFoundError); // another shop can't pay for it

    await prisma.tenant.update({ where: { id: S.tenant.id }, data: { payoutPhone: null } });
    await expect(prompt(b.publicToken)).rejects.toMatchObject({ code: "PAYMENTS_UNAVAILABLE" }); // online deposits are off
    await prisma.tenant.update({ where: { id: S.tenant.id }, data: { payoutPhone: "254722000111" } });

    await prisma.booking.update({ where: { id: b.id }, data: { status: "CONFIRMED" } });
    await expect(prompt(b.publicToken)).rejects.toMatchObject({ code: "NOT_PENDING" });
    expect(mpesa.pushes).toHaveLength(0);
  });

  it("limits prompts per booking: not twice in a row, and not endlessly", async () => {
    const b = await pendingBooking();
    await prompt(b.publicToken, PHONE, NOW);
    await expect(prompt(b.publicToken, PHONE, new Date(NOW.getTime() + 10_000))).rejects.toMatchObject({ code: "PROMPT_RECENT" });
    await prompt(b.publicToken, PHONE, new Date(NOW.getTime() + 60_000)); // after the gap a resend is fine
    expect(mpesa.pushes).toHaveLength(2);

    for (let i = 2; i < 5; i++) await prompt(b.publicToken, PHONE, new Date(NOW.getTime() + 60_000 * (i + 1)));
    await expect(prompt(b.publicToken, PHONE, new Date(NOW.getTime() + 600_000))).rejects.toMatchObject({ code: "TOO_MANY_PROMPTS" });
    expect(mpesa.pushes).toHaveLength(5);
  });

  it("if M-Pesa is down nothing is recorded and the booking keeps its hold", async () => {
    const b = await pendingBooking();
    mpesa.state.failPush = true;
    await expect(prompt(b.publicToken)).rejects.toBeInstanceOf(MpesaError);
    expect(await paymentsOf(b.id)).toHaveLength(0);
    expect((await booking(b.id)).status).toBe("PENDING_PAYMENT");
    mpesa.state.failPush = false;
    await expect(prompt(b.publicToken)).resolves.toBeTruthy(); // and a retry works
  });
});

describe("the callback endpoint: authenticity", () => {
  it("answers 404 to a wrong URL secret and does nothing, even with a perfectly valid body", async () => {
    const b = await pendingBooking();
    await prompt(b.publicToken);
    const push = mpesa.last();
    mpesa.approve(push.checkoutRequestId);
    for (const secret of ["wrong", "", CALLBACK_SECRET + "x", CALLBACK_SECRET.slice(0, -1)]) {
      const r = await deliver(callbackBody({ checkoutRequestId: push.checkoutRequestId, amountCents: 500 }), secret);
      expect(r.status, `secret ${JSON.stringify(secret)}`).toBe(404);
    }
    expect((await booking(b.id)).status).toBe("PENDING_PAYMENT");
    expect(mpesa.state.queries).toBe(0); // we didn't even look
  });

  it("rejects bodies that aren't STK callbacks (400) and ignores callbacks for prompts we never sent (200)", async () => {
    expect((await deliver("not json at all")).status).toBe(400);
    expect((await deliver({ hello: "world" })).status).toBe(400);
    const unknown = await deliver(callbackBody({ checkoutRequestId: "ws_CO_never_sent", amountCents: 500 }));
    expect(unknown.status).toBe(200);
    expect(await outcomeOf(unknown)).toBe("ignored");
  });

  it("a FORGED success callback does not confirm anything: Safaricom's own status answer decides", async () => {
    const b = await pendingBooking();
    await prompt(b.publicToken);
    const push = mpesa.last();

    // The attacker knows the CheckoutRequestID and the URL, and claims success. Safaricom says it's still waiting.
    mpesa.answer(push.checkoutRequestId, { status: "pending" });
    const claim = await deliver(callbackBody({ checkoutRequestId: push.checkoutRequestId, amountCents: 500, receipt: "FAKE123" }));
    expect(claim.status).toBe(200);
    expect(await outcomeOf(claim)).toBe("pending");
    expect((await booking(b.id)).status).toBe("PENDING_PAYMENT");
    expect((await paymentsOf(b.id))[0]).toMatchObject({ status: "PENDING", mpesaReceipt: null });

    // ...or Safaricom says the customer actually cancelled: the forged "success" still changes nothing good.
    mpesa.decline(push.checkoutRequestId);
    await deliver(callbackBody({ checkoutRequestId: push.checkoutRequestId, amountCents: 500, receipt: "FAKE123" }));
    expect((await booking(b.id)).status).toBe("PENDING_PAYMENT");
    expect((await paymentsOf(b.id))[0]).toMatchObject({ status: "FAILED", mpesaReceipt: null });
  });

  it("if Safaricom can't be reached to verify, the callback is acknowledged and left PENDING (resolved later), never trusted", async () => {
    const b = await pendingBooking();
    await prompt(b.publicToken);
    const push = mpesa.last();
    mpesa.state.failQuery = true;
    const r = await deliver(callbackBody({ checkoutRequestId: push.checkoutRequestId, amountCents: 500 }));
    expect(r.status).toBe(200);
    expect(await outcomeOf(r)).toBe("pending");
    expect((await booking(b.id)).status).toBe("PENDING_PAYMENT");
  });
});

describe("a successful payment", () => {
  it("confirms the booking, stores the M-Pesa receipt, and records the event in the ledger", async () => {
    const b = await pendingBooking();
    await prompt(b.publicToken);
    const push = mpesa.last();
    const r = await approve(push, "SFT2A1B3C4");

    expect(r.status).toBe(200);
    expect(await outcomeOf(r)).toBe("processed");
    expect(await booking(b.id)).toMatchObject({ status: "CONFIRMED", holdExpiresAt: null });
    expect((await paymentsOf(b.id))[0]).toMatchObject({ status: "SUCCEEDED", mpesaReceipt: "SFT2A1B3C4", resultCode: 0, applicationFeeCents: 25 });
    const ledger = await prisma.webhookEvent.findUniqueOrThrow({ where: { id: `mpesa:${push.checkoutRequestId}` } });
    expect(ledger.processedAt).not.toBeNull();
    expect(JSON.stringify(ledger.payload)).not.toContain(PHONE); // ids and codes only, no personal data
  });

  it("is idempotent: the same callback delivered again changes nothing", async () => {
    const b = await pendingBooking();
    await prompt(b.publicToken);
    const push = mpesa.last();
    expect(await outcomeOf(await approve(push, "RCP_ONCE"))).toBe("processed");
    for (let i = 0; i < 3; i++) {
      expect(await outcomeOf(await deliver(callbackBody({ checkoutRequestId: push.checkoutRequestId, amountCents: 500, receipt: "RCP_ONCE" })))).toBe("duplicate");
    }
    expect(await paymentsOf(b.id)).toHaveLength(1);
    expect(await prisma.webhookEvent.count({ where: { id: `mpesa:${push.checkoutRequestId}` } })).toBe(1);
  });

  it("is idempotent under CONCURRENT duplicate deliveries: exactly one applies", async () => {
    const b = await pendingBooking();
    await prompt(b.publicToken);
    const push = mpesa.last();
    // make double-application observable: the refund-flag path would show up as NEEDS_REFUND if it ran twice
    mpesa.approve(push.checkoutRequestId);
    const body = callbackBody({ checkoutRequestId: push.checkoutRequestId, amountCents: 500, receipt: "RCP_RACE" });
    const results = await Promise.all(Array.from({ length: 6 }, () => deliver(body)));
    expect(results.every((r) => r.status === 200)).toBe(true);
    const outcomes = await Promise.all(results.map(outcomeOf));
    expect(outcomes.filter((o) => o === "processed")).toHaveLength(1);
    expect(outcomes.filter((o) => o === "duplicate")).toHaveLength(5);
    expect((await paymentsOf(b.id))[0]).toMatchObject({ status: "SUCCEEDED", mpesaReceipt: "RCP_RACE" });
    expect((await booking(b.id)).status).toBe("CONFIRMED");
  });

  it("never confirms on an amount we didn't ask for", async () => {
    const b = await pendingBooking();
    await prompt(b.publicToken);
    const push = mpesa.last();
    mpesa.approve(push.checkoutRequestId);
    const r = await deliver(callbackBody({ checkoutRequestId: push.checkoutRequestId, amountCents: 100, receipt: "RCP_LOW" })); // KES 1 instead of KES 5
    expect(r.status).toBe(200); // acknowledged so Safaricom doesn't retry in a loop
    expect((await booking(b.id)).status).toBe("PENDING_PAYMENT");
    expect((await paymentsOf(b.id))[0].status).toBe("PENDING");
    const ledger = await prisma.webhookEvent.findUniqueOrThrow({ where: { id: `mpesa:${push.checkoutRequestId}` } });
    expect(ledger.error).toContain("Amount mismatch");
    expect(ledger.processedAt).toBeNull();
  });
});

describe("a payment that doesn't go through", () => {
  it.each([
    [1032, "cancelled", "Request cancelled by user"],
    [1, "insufficient_funds", "The balance is insufficient for the transaction"],
    [2001, "wrong_pin", "The initiator information is invalid"],
    [1037, "no_response", "DS timeout user cannot be reached"],
  ])("result %i marks the payment FAILED (%s) but keeps the booking held so the customer can retry", async (code, reason, desc) => {
    const b = await pendingBooking();
    await prompt(b.publicToken);
    const push = mpesa.last();
    mpesa.decline(push.checkoutRequestId, code, desc);
    const r = await deliver(callbackBody({ checkoutRequestId: push.checkoutRequestId, resultCode: code, resultDesc: desc }));
    expect(await outcomeOf(r)).toBe("processed");
    expect((await paymentsOf(b.id))[0]).toMatchObject({ status: "FAILED", failureReason: reason, resultCode: code });
    expect(await booking(b.id)).toMatchObject({ status: "PENDING_PAYMENT" });

    // and a second attempt can succeed
    await prompt(b.publicToken, PHONE, new Date(NOW.getTime() + 60_000));
    await approve(mpesa.last());
    expect((await booking(b.id)).status).toBe("CONFIRMED");
  });
});

describe("settling by polling (no callback needed)", () => {
  it("a status poll confirms a paid booking even if the callback never arrives; a late callback then fills in the receipt", async () => {
    const b = await pendingBooking();
    await prompt(b.publicToken);
    const push = mpesa.last();

    await mpesaSettlement.reconcileBookingDeposit(S.tenant.slug, b.publicToken, NOW);
    expect((await booking(b.id)).status).toBe("PENDING_PAYMENT"); // Safaricom: still waiting

    mpesa.approve(push.checkoutRequestId);
    await mpesaSettlement.reconcileBookingDeposit(S.tenant.slug, b.publicToken, new Date(NOW.getTime() + 10_000));
    expect(await booking(b.id)).toMatchObject({ status: "CONFIRMED" });
    expect((await paymentsOf(b.id))[0]).toMatchObject({ status: "SUCCEEDED", mpesaReceipt: null }); // a status query can't know the receipt

    const late = await deliver(callbackBody({ checkoutRequestId: push.checkoutRequestId, amountCents: 500, receipt: "RCP_LATE" }));
    expect(await outcomeOf(late)).toBe("duplicate");
    expect((await paymentsOf(b.id))[0].mpesaReceipt).toBe("RCP_LATE");
  });

  it("polls Safaricom at most once every few seconds however many tabs are open", async () => {
    const b = await pendingBooking();
    await prompt(b.publicToken);
    for (let i = 0; i < 5; i++) await mpesaSettlement.reconcileBookingDeposit(S.tenant.slug, b.publicToken, new Date(NOW.getTime() + i * 500));
    expect(mpesa.state.queries).toBe(1);
  });

  it("a prompt nobody answers for 10+ minutes is closed as 'no response'", async () => {
    const b = await pendingBooking();
    await prompt(b.publicToken);
    await mpesaSettlement.reconcileBookingDeposit(S.tenant.slug, b.publicToken, new Date(NOW.getTime() + 11 * 60_000));
    expect((await paymentsOf(b.id))[0]).toMatchObject({ status: "FAILED", failureReason: "no_response" });
    expect((await booking(b.id)).status).toBe("PENDING_PAYMENT"); // still held until the hold itself lapses
  });
});

describe("edge cases: paying twice, and paying after the hold lapsed", () => {
  it("two prompts both approved: the first confirms, the second is flagged for refund, the booking stays confirmed", async () => {
    const b = await pendingBooking();
    await prompt(b.publicToken, PHONE, NOW);
    const first = mpesa.last();
    await prompt(b.publicToken, PHONE, new Date(NOW.getTime() + 60_000));
    const second = mpesa.last();
    await approve(first, "RCP_FIRST");
    await approve(second, "RCP_SECOND");

    expect((await booking(b.id)).status).toBe("CONFIRMED");
    const byReceipt = Object.fromEntries((await paymentsOf(b.id)).map((p) => [p.mpesaReceipt, p]));
    expect(byReceipt.RCP_FIRST.status).toBe("SUCCEEDED");
    expect(byReceipt.RCP_SECOND).toMatchObject({ status: "NEEDS_REFUND", failureReason: "duplicate_payment" });
  });

  async function lapsed() {
    const b = await pendingBooking();
    await prompt(b.publicToken);
    const push = mpesa.last();
    await bookingRepo.expireAllStaleHolds(LATER); // the hold lapses before the customer's approval lands
    expect(await booking(b.id)).toMatchObject({ status: "CANCELLED", cancelReason: "hold_expired" });
    return { b, push };
  }

  it("hold lapsed but the slot is still free: the booking is REVIVED and confirmed", async () => {
    const { b, push } = await lapsed();
    await approve(push, "RCP_REVIVE");
    expect(await booking(b.id)).toMatchObject({ status: "CONFIRMED", cancelReason: null, cancelledAt: null });
    expect((await paymentsOf(b.id))[0].status).toBe("SUCCEEDED");
  });

  it("hold lapsed and someone else took the slot: the payment is flagged NEEDS_REFUND and the other booking is untouched", async () => {
    const { b, push } = await lapsed();
    const other = await pendingBooking({ now: LATER }); // the freed slot is booked by another customer
    await approve(push, "RCP_TOOLATE");

    expect((await booking(b.id)).status).toBe("CANCELLED");
    expect((await paymentsOf(b.id))[0]).toMatchObject({ status: "NEEDS_REFUND", failureReason: "slot_taken", mpesaReceipt: "RCP_TOOLATE" });
    expect((await booking(other.id)).status).toBe("PENDING_PAYMENT");
  });

  it("the shop cancelled the booking, then the customer paid anyway: flagged for refund", async () => {
    const b = await pendingBooking();
    await prompt(b.publicToken);
    const push = mpesa.last();
    await bookingService.setBookingStatus(ownerCtx, b.id, "CANCELLED", NOW);
    await approve(push);
    expect((await booking(b.id)).status).toBe("CANCELLED");
    expect((await paymentsOf(b.id))[0]).toMatchObject({ status: "NEEDS_REFUND", failureReason: "booking_cancelled" });
  });
});

describe("what the confirmation page is told", () => {
  it("reports the latest prompt (masked number, status, failure reason) and whether the customer can still pay", async () => {
    const b = await pendingBooking();
    expect((await publicBooking.getConfirmation(S.tenant.slug, b.publicToken, NOW)).booking).toMatchObject({ status: "PENDING_PAYMENT", payable: true, payment: null });

    await prompt(b.publicToken);
    expect((await publicBooking.getConfirmation(S.tenant.slug, b.publicToken, NOW)).booking.payment).toMatchObject({ status: "PENDING", maskedPhone: "07•• ••• 678" });
    expect((await publicBooking.getConfirmation(S.tenant.slug, b.publicToken, LATER)).booking.payable).toBe(false); // hold lapsed

    const push = mpesa.last();
    mpesa.decline(push.checkoutRequestId, 1, "insufficient");
    await deliver(callbackBody({ checkoutRequestId: push.checkoutRequestId, resultCode: 1 }));
    expect((await publicBooking.getConfirmation(S.tenant.slug, b.publicToken, NOW)).booking.payment).toMatchObject({ status: "FAILED", failureReason: "insufficient_funds" });

    await prompt(b.publicToken, PHONE, new Date(NOW.getTime() + 60_000));
    await approve(mpesa.last());
    expect((await publicBooking.getConfirmation(S.tenant.slug, b.publicToken, NOW)).booking).toMatchObject({ status: "CONFIRMED", payable: false, depositPaidOnline: true });
  });
});

describe("the scheduled sweep (cron)", () => {
  const call = (secret?: string) => cronGet(new Request("http://localhost:3000/api/cron/expire-holds", { headers: secret ? { authorization: `Bearer ${secret}` } : {} }));

  it("refuses callers without the right secret", async () => {
    expect((await call()).status).toBe(401);
    expect((await call("wrong")).status).toBe(401);
    expect((await call("cron-secret-for-tests-but-longer")).status).toBe(401);
  });

  it("settles a prompt that was approved but whose callback never came, cancels expired holds, and leaves everything else alone", async () => {
    const approved = await pendingBooking({ startsAt: SLOT_A });
    await prompt(approved.publicToken);
    mpesa.approve(mpesa.last().checkoutRequestId);

    const abandoned = await pendingBooking({ startsAt: SLOT_B });
    await prompt(abandoned.publicToken);
    // Safaricom still says "pending" for it, and its hold has lapsed
    await prisma.booking.update({ where: { id: abandoned.id }, data: { holdExpiresAt: new Date(Date.now() - 60_000) } });
    await prisma.payment.updateMany({ where: { bookingId: abandoned.id }, data: { createdAt: new Date(Date.now() - 30 * 60_000) } });
    await prisma.payment.updateMany({ where: { bookingId: approved.id }, data: { createdAt: new Date(Date.now() - 5 * 60_000) } });

    const confirmed = await pendingBooking({ startsAt: "2031-07-02T16:00:00.000Z" });
    await prisma.booking.update({ where: { id: confirmed.id }, data: { status: "CONFIRMED", holdExpiresAt: null } });

    const r = await call("cron-secret-for-tests");
    expect(r.status).toBe(200);
    const result = await r.json();
    expect(result).toMatchObject({ promptsSettled: 2, holdsCancelled: 1 });

    expect((await booking(approved.id)).status).toBe("CONFIRMED"); // honoured despite the missing callback
    expect((await paymentsOf(abandoned.id))[0]).toMatchObject({ status: "FAILED", failureReason: "no_response" });
    expect((await booking(abandoned.id))).toMatchObject({ status: "CANCELLED", cancelReason: "hold_expired" });
    expect((await booking(confirmed.id)).status).toBe("CONFIRMED");

    expect(await (await call("cron-secret-for-tests")).json()).toMatchObject({ promptsSettled: 0, holdsCancelled: 0 }); // idempotent
  });
});
