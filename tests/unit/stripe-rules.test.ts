import { afterEach, describe, expect, it, vi } from "vitest";
import { MIN_DEPOSIT_CENTS, PLATFORM_FEE_PERCENT, platformFeeCents } from "@/lib/constants/business";
import { createServiceInput, serviceFormInput, updateServiceInput } from "@/validators/catalog";
import { firstServiceInput } from "@/validators/tenant";

describe("platform fee", () => {
  it("is the configured percent of the deposit, rounded DOWN to a whole cent", () => {
    expect(PLATFORM_FEE_PERCENT).toBe(5);
    expect(platformFeeCents(1000)).toBe(50);
    expect(platformFeeCents(500)).toBe(25);
    expect(platformFeeCents(999)).toBe(49);
    expect(platformFeeCents(50)).toBe(2);
    expect(platformFeeCents(0)).toBe(0);
  });
  it("never exceeds the deposit", () => {
    for (const d of [0, 1, 50, 99, 1000, 12345]) expect(platformFeeCents(d)).toBeLessThanOrEqual(d);
  });
});

describe("minimum deposit (Stripe cannot charge less than 50 cents)", () => {
  const svc = { name: "Cut", durationMin: 30, priceCents: 3000 };
  it("allows free or at least the minimum, on every way of creating or editing a service", () => {
    expect(MIN_DEPOSIT_CENTS).toBe(50);
    expect(createServiceInput.safeParse({ ...svc, depositCents: 0 }).success).toBe(true);
    expect(createServiceInput.safeParse({ ...svc, depositCents: 50 }).success).toBe(true);
    expect(createServiceInput.safeParse({ ...svc, depositCents: 49 }).success).toBe(false);
    expect(createServiceInput.safeParse({ ...svc, depositCents: 1 }).success).toBe(false);
    expect(updateServiceInput.safeParse({ depositCents: 25 }).success).toBe(false);
    expect(updateServiceInput.safeParse({ depositCents: 500 }).success).toBe(true);
  });
  it("applies to the dashboard form (dollars) and the onboarding wizard too", () => {
    const form = { name: "Cut", description: "", durationMin: "30", price: "30", active: true, staffIds: [] };
    expect(serviceFormInput.safeParse({ ...form, deposit: "0.25" }).success).toBe(false);
    expect(serviceFormInput.safeParse({ ...form, deposit: "0.50" }).success).toBe(true);
    const onboarding = { name: "Cut", durationMin: 30, price: "30" };
    expect(firstServiceInput.safeParse({ ...onboarding, deposit: "0.25" }).success).toBe(false);
    expect(firstServiceInput.safeParse({ ...onboarding, deposit: "5" }).success).toBe(true);
  });
});

describe("test-mode only", () => {
  afterEach(() => vi.unstubAllEnvs());
  async function clientWith(key: string) {
    vi.resetModules();
    vi.stubEnv("DATABASE_URL", "postgresql://unused:unused@localhost:1/unused"); // env.ts validates it on import
    vi.stubEnv("STRIPE_SECRET_KEY", key);
    return (await import("@/lib/stripe")).getStripe;
  }
  it("refuses a live secret key before any request can be made", async () => {
    expect((await clientWith("sk_live_abcdef"))).toThrow(/test-mode only/);
    expect((await clientWith("rk_live_abcdef"))).toThrow(/test-mode only/);
    expect((await clientWith("not-a-key"))).toThrow(/test-mode only/);
  });
  it("accepts test keys (secret and restricted)", async () => {
    expect((await clientWith("sk_test_abcdef"))()).toBeTruthy();
    expect((await clientWith("rk_test_abcdef"))()).toBeTruthy();
  });
});
