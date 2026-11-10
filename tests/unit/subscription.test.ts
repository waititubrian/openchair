import { describe, expect, it } from "vitest";
import { daysUntil, graceEnd, hasProAccess, nextPeriodEnd, subscriptionState } from "@/lib/subscription";
import { failureMessage, failureReason } from "@/lib/mpesa-results";
import { callbackDetails, stkCallbackBody } from "@/validators/mpesa";

const at = (s: string) => new Date(s);
const DAY = 86_400_000;

describe("subscription state", () => {
  const end = at("2031-08-01T00:00:00Z");
  it("a shop that never paid is Free", () => expect(subscriptionState(null, at("2031-07-01T00:00:00Z"))).toEqual({ state: "free" }));

  it("is active until the period end, then in grace for 3 days, then expired", () => {
    expect(subscriptionState({ currentPeriodEnd: end }, at("2031-07-20T00:00:00Z"))).toMatchObject({ state: "active", daysLeft: 12 });
    expect(subscriptionState({ currentPeriodEnd: end }, at("2031-07-31T23:59:59Z")).state).toBe("active");
    expect(subscriptionState({ currentPeriodEnd: end }, at("2031-08-01T00:00:00Z")).state).toBe("grace"); // the boundary instant is already grace
    expect(subscriptionState({ currentPeriodEnd: end }, at("2031-08-03T23:59:59Z"))).toMatchObject({ state: "grace" });
    expect(subscriptionState({ currentPeriodEnd: end }, at("2031-08-04T00:00:00Z")).state).toBe("expired");
  });
  it("Pro access lasts through grace and ends when expired", () => {
    const s = (iso: string) => hasProAccess(subscriptionState({ currentPeriodEnd: end }, at(iso)));
    expect(s("2031-07-01T00:00:00Z")).toBe(true);
    expect(s("2031-08-02T00:00:00Z")).toBe(true);
    expect(s("2031-08-05T00:00:00Z")).toBe(false);
    expect(hasProAccess({ state: "free" })).toBe(false);
  });
  it("counts whole days remaining, rounding up and never going negative", () => {
    expect(daysUntil(at("2031-08-01T00:00:00Z"), at("2031-07-31T12:00:00Z"))).toBe(1);
    expect(daysUntil(at("2031-08-01T00:00:00Z"), at("2031-08-02T00:00:00Z"))).toBe(0);
    expect(graceEnd(end).toISOString()).toBe("2031-08-04T00:00:00.000Z");
  });
});

describe("renewal period maths", () => {
  const now = at("2031-07-10T09:00:00Z");
  it("a first payment buys 30 days from now", () => expect(nextPeriodEnd(null, now).toISOString()).toBe("2031-08-09T09:00:00.000Z"));
  it("renewing while still active EXTENDS from the current end (paying early loses nothing)", () => {
    const existing = { currentPeriodEnd: at("2031-07-20T00:00:00Z") };
    expect(nextPeriodEnd(existing, now).toISOString()).toBe("2031-08-19T00:00:00.000Z");
  });
  it("a lapsed subscription restarts from now, not from the old end", () => {
    const existing = { currentPeriodEnd: at("2031-06-01T00:00:00Z") };
    expect(nextPeriodEnd(existing, now).getTime() - now.getTime()).toBe(30 * DAY);
  });
  it("paying during grace starts from now (the period already ended)", () => {
    const existing = { currentPeriodEnd: at("2031-07-09T09:00:00Z") };
    expect(nextPeriodEnd(existing, now).toISOString()).toBe("2031-08-09T09:00:00.000Z");
  });
});

describe("M-Pesa result codes", () => {
  it("maps Safaricom's codes to reasons and sentences a person can act on", () => {
    expect(failureReason(1032)).toBe("cancelled");
    expect(failureReason(1)).toBe("insufficient_funds");
    expect(failureReason(2001)).toBe("wrong_pin");
    expect(failureReason(1037)).toBe("no_response");
    expect(failureReason(9999)).toBe("failed");
    expect(failureMessage("cancelled")).toMatch(/cancelled/);
    expect(failureMessage("insufficient_funds")).toMatch(/balance/);
    expect(failureMessage("no_response")).toMatch(/in time/);
    expect(failureMessage(undefined)).toMatch(/didn't go through/);
  });
});

describe("STK callback parsing", () => {
  const success = {
    Body: {
      stkCallback: {
        MerchantRequestID: "m-1",
        CheckoutRequestID: "ws_CO_1",
        ResultCode: 0,
        ResultDesc: "The service request is processed successfully.",
        CallbackMetadata: {
          Item: [
            { Name: "Amount", Value: 100 },
            { Name: "MpesaReceiptNumber", Value: "SFT2A1B3C4" },
            { Name: "TransactionDate", Value: 20310701150000 },
            { Name: "PhoneNumber", Value: 254712345678 },
          ],
        },
      },
    },
  };
  it("extracts the amount (as cents) and receipt from a success", () => {
    const body = stkCallbackBody.parse(success);
    expect(callbackDetails(body)).toEqual({ amountCents: 10_000, receipt: "SFT2A1B3C4" });
  });
  it("a failure has no metadata and still parses", () => {
    const body = stkCallbackBody.parse({ Body: { stkCallback: { MerchantRequestID: "m", CheckoutRequestID: "c", ResultCode: 1032, ResultDesc: "Request cancelled by user" } } });
    expect(body.Body.stkCallback.ResultCode).toBe(1032);
    expect(callbackDetails(body)).toEqual({ amountCents: null, receipt: null });
  });
  it("rejects bodies that aren't STK callbacks", () => {
    expect(stkCallbackBody.safeParse({}).success).toBe(false);
    expect(stkCallbackBody.safeParse({ Body: {} }).success).toBe(false);
    expect(stkCallbackBody.safeParse({ Body: { stkCallback: { CheckoutRequestID: "", MerchantRequestID: "m", ResultCode: 0 } } }).success).toBe(false);
  });
});
