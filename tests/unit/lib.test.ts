import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/password";
import { can } from "@/lib/permissions";
import { safeNextPath } from "@/lib/redirect";
import { formatMoney, parseMoneyToCents } from "@/lib/money";
import { hhmmToMinutes, minutesToHhmm } from "@/lib/time";
import { platformFeeCents } from "@/lib/constants/business";

describe("permissions", () => {
  it("lets OWNER do everything", () => {
    for (const p of ["billing:manage", "payouts:manage", "settings:manage", "bookings:write"] as const) {
      expect(can("OWNER", p)).toBe(true);
    }
  });
  it("keeps STAFF out of billing, payouts and settings but gives them bookings", () => {
    expect(can("STAFF", "billing:manage")).toBe(false);
    expect(can("STAFF", "payouts:manage")).toBe(false);
    expect(can("STAFF", "settings:manage")).toBe(false);
    expect(can("STAFF", "bookings:read")).toBe(true);
    expect(can("STAFF", "bookings:write")).toBe(true);
  });
});

describe("safeNextPath (open redirect guard)", () => {
  it("allows local paths", () => expect(safeNextPath("/dashboard/bookings?x=1")).toBe("/dashboard/bookings?x=1"));
  it.each(["//evil.com", "https://evil.com", "/\\evil.com", "evil", undefined, 5])("rejects %j", (v) => {
    expect(safeNextPath(v)).toBe("/dashboard");
  });
});

describe("password hashing", () => {
  it("verifies the right password and rejects wrong ones and garbage", async () => {
    const h = await hashPassword("correct horse");
    expect(await verifyPassword("correct horse", h)).toBe(true);
    expect(await verifyPassword("wrong", h)).toBe(false);
    expect(await verifyPassword("x", "not-a-hash")).toBe(false);
  });
  it("salts: same password hashes differently", async () => {
    expect(await hashPassword("same")).not.toBe(await hashPassword("same"));
  });
});

describe("money and time helpers", () => {
  it("parses money to integer cents without float error", () => {
    expect(parseMoneyToCents("35")).toBe(3500);
    expect(parseMoneyToCents("$35.5")).toBe(3550);
    expect(parseMoneyToCents("0.07")).toBe(7);
    expect(parseMoneyToCents("1,234.56")).toBe(123456);
    expect(parseMoneyToCents("-1")).toBeNull();
    expect(parseMoneyToCents("1.234")).toBeNull();
  });
  it("formats cents", () => expect(formatMoney(3550)).toBe("$35.50"));
  it("round-trips HH:MM", () => {
    expect(hhmmToMinutes("09:30")).toBe(570);
    expect(minutesToHhmm(570)).toBe("09:30");
    expect(hhmmToMinutes("24:00")).toBe(1440);
    expect(hhmmToMinutes("25:00")).toBeNull();
    expect(hhmmToMinutes("9:75")).toBeNull();
  });
  it("platform fee is 5% rounded down", () => {
    expect(platformFeeCents(1000)).toBe(50);
    expect(platformFeeCents(999)).toBe(49);
  });
});
