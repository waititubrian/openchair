import { describe, expect, it } from "vitest";
import { CURRENCY, MPESA, PLANS, SUBSCRIPTION, platformFeeCents } from "@/lib/constants/business";
import { centsToInput, formatMoney, isWholeShillings, parseMoneyToCents } from "@/lib/money";
import { formatKenyanPhone, maskKenyanPhone, normalizeKenyanPhone } from "@/lib/phone";
import { createServiceInput, serviceFormInput, updateServiceInput } from "@/validators/catalog";
import { createPublicBookingInput } from "@/validators/booking";
import { firstServiceInput } from "@/validators/tenant";

describe("KES money", () => {
  it("the app's currency and plan prices are in shillings", () => {
    expect(CURRENCY).toBe("kes");
    expect(PLANS.PRO.priceCentsPerMonth).toBe(250_000); // KES 2,500
    expect(PLANS.FREE.priceCentsPerMonth).toBe(0);
    expect(SUBSCRIPTION).toEqual({ periodDays: 30, graceDays: 3 });
  });
  it("formats whole shillings without decimals", () => {
    expect(formatMoney(250_000)).toBe("KSh 2,500");
    expect(formatMoney(50_000, "kes")).toBe("KSh 500");
    expect(formatMoney(0)).toBe("KSh 0");
    expect(formatMoney(12_550)).toBe("KSh 125.50"); // legacy non-whole values still display honestly
  });
  it("parses what people type into integer cents", () => {
    expect(parseMoneyToCents("1500")).toBe(150_000);
    expect(parseMoneyToCents("1,500")).toBe(150_000);
    expect(parseMoneyToCents("KSh 1,500")).toBe(150_000);
    expect(parseMoneyToCents("kes 300")).toBe(30_000);
    expect(parseMoneyToCents("0")).toBe(0);
    expect(parseMoneyToCents("12.5")).toBe(1_250);
    for (const bad of ["", "abc", "-5", "1.234", "KSh"]) expect(parseMoneyToCents(bad), bad).toBeNull();
  });
  it("round-trips through the input helper", () => {
    expect(centsToInput(150_000)).toBe("1500");
    expect(centsToInput(1_250)).toBe("12.50");
    expect(isWholeShillings(150_000)).toBe(true);
    expect(isWholeShillings(150_050)).toBe(false);
  });
  it("the platform fee is 5% of the deposit, rounded down to a cent", () => {
    expect(platformFeeCents(10_000)).toBe(500); // KES 100 deposit -> KES 5
    expect(platformFeeCents(15_000)).toBe(750); // KES 150 -> KES 7.50
    expect(platformFeeCents(0)).toBe(0);
  });
});

describe("whole-shilling rule everywhere money is entered", () => {
  const svc = { name: "Cut", durationMin: 30, priceCents: 50_000 };
  it("API shapes accept whole shillings and refuse cents or amounts above M-Pesa's limit", () => {
    expect(createServiceInput.safeParse({ ...svc, depositCents: 10_000 }).success).toBe(true);
    expect(createServiceInput.safeParse({ ...svc, depositCents: 0 }).success).toBe(true);
    expect(createServiceInput.safeParse({ ...svc, depositCents: 10_050 }).success).toBe(false); // KES 100.50
    expect(createServiceInput.safeParse({ ...svc, priceCents: 50_050, depositCents: 0 }).success).toBe(false);
    expect(createServiceInput.safeParse({ ...svc, priceCents: MPESA.maxAmountCents + 100, depositCents: 0 }).success).toBe(false);
    expect(updateServiceInput.safeParse({ depositCents: 99 }).success).toBe(false);
  });
  it("the dashboard form takes shillings as text", () => {
    const form = { name: "Cut", description: "", durationMin: "30", active: true, staffIds: [] };
    expect(serviceFormInput.parse({ ...form, price: "500", deposit: "100" })).toMatchObject({ priceCents: 50_000, depositCents: 10_000 });
    expect(serviceFormInput.parse({ ...form, price: "KSh 1,500", deposit: "0" })).toMatchObject({ priceCents: 150_000 });
    expect(serviceFormInput.safeParse({ ...form, price: "500.50", deposit: "100" }).success).toBe(false);
    expect(serviceFormInput.safeParse({ ...form, price: "cheap", deposit: "100" }).success).toBe(false);
  });
  it("and so does the onboarding wizard", () => {
    expect(firstServiceInput.parse({ name: "Cut", durationMin: 30, price: "500", deposit: "100" })).toMatchObject({ price: 50_000, deposit: 10_000 });
    expect(firstServiceInput.safeParse({ name: "Cut", durationMin: 30, price: "500", deposit: "600" }).success).toBe(false); // deposit > price
    expect(firstServiceInput.safeParse({ name: "Cut", durationMin: 30, price: "500.5", deposit: "100" }).success).toBe(false);
  });
});

describe("Kenyan phone numbers", () => {
  it.each([
    ["0712345678", "254712345678"],
    ["0712 345 678", "254712345678"],
    ["+254 712 345 678", "254712345678"],
    ["254712345678", "254712345678"],
    ["712345678", "254712345678"],
    ["0112345678", "254112345678"], // the newer 01 range
    ["07-12.34 56(78)", "254712345678"],
  ])("normalises %s", (input, expected) => expect(normalizeKenyanPhone(input)).toBe(expected));

  it.each(["", "12345", "0212345678", "+255712345678", "07123456789", "0812345678", "abcdefghij", "254212345678"])("rejects %j", (bad) =>
    expect(normalizeKenyanPhone(bad)).toBeNull(),
  );
  it("formats and masks for display", () => {
    expect(formatKenyanPhone("254712345678")).toBe("0712 345 678");
    expect(maskKenyanPhone("254712345678")).toBe("07•• ••• 678");
  });
  it("the booking form accepts a blank phone but normalises a real one and rejects junk", () => {
    const base = { tenantSlug: "s", serviceId: "x", startsAt: "2031-07-02T14:00:00.000Z", name: "A", email: "a@b.co" };
    expect(createPublicBookingInput.parse({ ...base, phone: "" }).phone).toBeUndefined();
    expect(createPublicBookingInput.parse({ ...base, phone: "0712 345 678" }).phone).toBe("254712345678");
    expect(createPublicBookingInput.safeParse({ ...base, phone: "call me" }).success).toBe(false);
  });
});
