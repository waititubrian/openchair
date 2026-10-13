import { describe, expect, it } from "vitest";
import { signInInput, signUpInput } from "@/validators/auth";
import { onboardingInput, slugSchema } from "@/validators/tenant";

const validOnboarding = {
  shopName: "Fade & Co",
  slug: "fade-and-co",
  timezone: "America/New_York",
  service: { name: "Haircut", durationMin: 30, price: "35", deposit: "10" },
  hours: [{ dayOfWeek: 1, start: "09:00", end: "17:00" }],
};

describe("slugSchema", () => {
  it("normalises case and accepts hyphenated slugs", () => {
    expect(slugSchema.parse("  Fade-And-Co ")).toBe("fade-and-co");
  });
  it.each(["ab", "-bad", "bad-", "no--double", "has space", "under_score", "a".repeat(41)])("rejects %j", (s) => {
    expect(slugSchema.safeParse(s).success).toBe(false);
  });
  it.each(["admin", "api", "login", "dashboard"])("rejects reserved word %j", (s) => {
    expect(slugSchema.safeParse(s).success).toBe(false);
  });
});

describe("auth inputs", () => {
  it("lowercases and trims email", () => {
    expect(signUpInput.parse({ name: "A", email: "  A@B.Com ", password: "12345678" }).email).toBe("a@b.com");
  });
  it("requires 8+ char passwords on sign up but not sign in", () => {
    expect(signUpInput.safeParse({ name: "A", email: "a@b.com", password: "short" }).success).toBe(false);
    expect(signInInput.safeParse({ email: "a@b.com", password: "x" }).success).toBe(true);
  });
});

describe("onboardingInput", () => {
  it("converts dollars to cents and HH:MM to minutes", () => {
    const out = onboardingInput.parse(validOnboarding);
    expect(out.service.price).toBe(3500);
    expect(out.service.deposit).toBe(1000);
    expect(out.hours[0]).toEqual({ dayOfWeek: 1, start: 540, end: 1020 });
  });
  it("rejects a deposit above the price", () => {
    const r = onboardingInput.safeParse({ ...validOnboarding, service: { ...validOnboarding.service, deposit: "40" } });
    expect(r.success).toBe(false);
  });
  it("rejects closing before opening, duplicate days, no days and bad timezones", () => {
    expect(onboardingInput.safeParse({ ...validOnboarding, hours: [{ dayOfWeek: 1, start: "17:00", end: "09:00" }] }).success).toBe(false);
    const day = { dayOfWeek: 1, start: "09:00", end: "10:00" };
    expect(onboardingInput.safeParse({ ...validOnboarding, hours: [day, day] }).success).toBe(false);
    expect(onboardingInput.safeParse({ ...validOnboarding, hours: [] }).success).toBe(false);
    expect(onboardingInput.safeParse({ ...validOnboarding, timezone: "Mars/Olympus" }).success).toBe(false);
  });
  it("rejects non-money strings and odd durations", () => {
    expect(onboardingInput.safeParse({ ...validOnboarding, service: { ...validOnboarding.service, price: "abc" } }).success).toBe(false);
    expect(onboardingInput.safeParse({ ...validOnboarding, service: { ...validOnboarding.service, durationMin: 33 } }).success).toBe(false);
  });
});
