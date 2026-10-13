import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { ConflictError } from "@/lib/errors";
import * as tenantService from "@/services/tenant.service";
import { onboardingInput } from "@/validators/tenant";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
const run = Math.random().toString(36).slice(2, 8);
const createdUsers: string[] = [];

async function newUser(label: string) {
  const u = await prisma.user.create({ data: { email: `${label}-${run}@it.example.com`, name: `User ${label}` } });
  createdUsers.push(u.id);
  return u;
}

const input = (slug: string, overrides: Record<string, unknown> = {}) =>
  onboardingInput.parse({
    shopName: "IT Shop",
    slug,
    timezone: "Europe/London",
    service: { name: "Cut", durationMin: 30, price: "30", deposit: "5" },
    hours: [{ dayOfWeek: 2, start: "09:00", end: "17:00" }],
    ...overrides,
  });

afterEach(async () => {
  const memberships = await prisma.membership.findMany({ where: { userId: { in: createdUsers } }, select: { tenantId: true } });
  await prisma.tenant.deleteMany({ where: { OR: [{ id: { in: memberships.map((m) => m.tenantId) } }, { slug: { startsWith: `it-${run}` } }] } });
  await prisma.user.deleteMany({ where: { id: { in: createdUsers } } });
  createdUsers.length = 0;
});
afterAll(() => prisma.$disconnect());

describe("tenantService.onboard (real database)", () => {
  it("creates the shop, owner membership, service, staff and hours, all under one tenantId", async () => {
    const user = await newUser("a");
    const tenant = await tenantService.onboard(user.id, input(`it-${run}-a`));

    const [membership, services, staff, rules] = await Promise.all([
      prisma.membership.findMany({ where: { tenantId: tenant.id } }),
      prisma.service.findMany({ where: { tenantId: tenant.id } }),
      prisma.staffMember.findMany({ where: { tenantId: tenant.id }, include: { staffServices: true } }),
      prisma.availabilityRule.findMany({ where: { tenantId: tenant.id } }),
    ]);
    expect(membership).toEqual([expect.objectContaining({ userId: user.id, role: "OWNER" })]);
    expect(services).toEqual([expect.objectContaining({ priceCents: 3000, depositCents: 500, durationMin: 30 })]);
    expect(staff).toHaveLength(1);
    expect(staff[0].userId).toBe(user.id);
    expect(staff[0].staffServices).toHaveLength(1);
    expect(rules).toEqual([expect.objectContaining({ dayOfWeek: 2, startMinute: 540, endMinute: 1020 })]);
    expect(tenant.timezone).toBe("Europe/London");
  });

  it("rolls everything back if a later step fails (no half-created shop)", async () => {
    const user = await newUser("b");
    const slug = `it-${run}-b`;
    // 1500 minutes violates the availability_valid CHECK constraint, the LAST statement in the transaction.
    const bad = input(slug, { hours: [{ dayOfWeek: 1, start: "09:00", end: "17:00" }] });
    bad.hours[0].end = 1500;

    await expect(tenantService.onboard(user.id, bad)).rejects.toThrow();
    expect(await prisma.tenant.count({ where: { slug } })).toBe(0);
    expect(await prisma.membership.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.service.count({ where: { name: "Cut", tenant: { slug } } })).toBe(0);
  });

  it("allows one shop per user", async () => {
    const user = await newUser("c");
    await tenantService.onboard(user.id, input(`it-${run}-c1`));
    await expect(tenantService.onboard(user.id, input(`it-${run}-c2`))).rejects.toMatchObject({ code: "ALREADY_ONBOARDED" });
  });

  it("lets exactly one of two simultaneous claims of the same slug win", async () => {
    const [u1, u2] = [await newUser("d1"), await newUser("d2")];
    const slug = `it-${run}-d`;
    const results = await Promise.allSettled([
      tenantService.onboard(u1.id, input(slug)),
      tenantService.onboard(u2.id, input(slug)),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0].reason).toBeInstanceOf(ConflictError);
    expect(await prisma.tenant.count({ where: { slug } })).toBe(1);
  });

  it("reports slug availability", async () => {
    expect(await tenantService.isSlugAvailable("fade-and-co")).toMatchObject({ available: false }); // seeded demo shop
    expect(await tenantService.isSlugAvailable(`it-${run}-free`)).toEqual({ available: true });
    expect(await tenantService.isSlugAvailable("admin")).toMatchObject({ available: false, reason: "That name is reserved" });
  });
});
