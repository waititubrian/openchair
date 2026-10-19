import type { TestPrisma } from "./db.mts";

export type ShopFixture = {
  label: string;
  marker: string; // unique text that appears in every row of this shop: if it shows up elsewhere, data leaked
  tenant: { id: string; slug: string; name: string };
  owner: { id: string; email: string };
  staffUser: { id: string; email: string };
  /** The OWNER's own StaffMember (userId = owner). */
  ownerStaff: { id: string };
  /** The STAFF user's own StaffMember (userId = staffUser). */
  staffUserStaff: { id: string };
  service: { id: string };
  customer: { id: string };
  booking: { id: string };
  /** Time off belonging to the OWNER's staff member. */
  ownerTimeOff: { id: string };
  /** Time off belonging to the STAFF user's staff member. */
  staffUserTimeOff: { id: string };
};

/**
 * Build one complete shop around two EXISTING users (one becomes OWNER, one STAFF).
 * Callers create the users, either plain via Prisma (service tests) or through the real
 * sign-up endpoint (e2e), so the fixture works for both.
 */
export async function seedShop(
  prisma: TestPrisma,
  run: string,
  label: string,
  users: { owner: { id: string; email: string }; staffUser: { id: string; email: string } },
): Promise<ShopFixture> {
  const marker = `ISO-${label}-${run}`;
  const tenant = await prisma.tenant.create({
    data: { slug: `iso-${run}-${label.toLowerCase()}`, name: `${marker} Shop`, timezone: "America/New_York" },
  });
  await prisma.membership.create({ data: { tenantId: tenant.id, userId: users.owner.id, role: "OWNER" } });
  await prisma.membership.create({ data: { tenantId: tenant.id, userId: users.staffUser.id, role: "STAFF" } });

  const service = await prisma.service.create({
    data: { tenantId: tenant.id, name: `${marker} Cut`, durationMin: 30, priceCents: 3000, depositCents: 500 },
  });
  const ownerStaff = await prisma.staffMember.create({
    data: { tenantId: tenant.id, name: `${marker} Owner Barber`, userId: users.owner.id },
  });
  const staffUserStaff = await prisma.staffMember.create({
    data: { tenantId: tenant.id, name: `${marker} Staff Barber`, userId: users.staffUser.id },
  });
  await prisma.staffService.createMany({
    data: [ownerStaff, staffUserStaff].map((s) => ({ tenantId: tenant.id, staffId: s.id, serviceId: service.id })),
  });
  for (const s of [ownerStaff, staffUserStaff]) {
    await prisma.availabilityRule.create({
      data: { tenantId: tenant.id, staffId: s.id, dayOfWeek: 2, startMinute: 540, endMinute: 1020 },
    });
  }
  const customer = await prisma.customer.create({
    data: { tenantId: tenant.id, name: `${marker} Customer`, email: `cust-${label.toLowerCase()}-${run}@it.example.com` },
  });
  const startsAt = new Date(Date.now() + 3 * 86_400_000);
  const booking = await prisma.booking.create({
    data: {
      tenantId: tenant.id,
      serviceId: service.id,
      staffId: ownerStaff.id,
      customerId: customer.id,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 30 * 60_000),
      status: "CONFIRMED",
      priceCents: 3000,
      depositCents: 500,
    },
  });
  const day = 86_400_000;
  const ownerTimeOff = await prisma.timeOff.create({
    data: { tenantId: tenant.id, staffId: ownerStaff.id, startsAt: new Date(Date.now() + 10 * day), endsAt: new Date(Date.now() + 11 * day), reason: `${marker} owner off` },
  });
  const staffUserTimeOff = await prisma.timeOff.create({
    data: { tenantId: tenant.id, staffId: staffUserStaff.id, startsAt: new Date(Date.now() + 12 * day), endsAt: new Date(Date.now() + 13 * day), reason: `${marker} staff off` },
  });

  return {
    label,
    marker,
    tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name },
    owner: users.owner,
    staffUser: users.staffUser,
    ownerStaff,
    staffUserStaff,
    service,
    customer,
    booking,
    ownerTimeOff,
    staffUserTimeOff,
  };
}

/** Remove everything a run created (bookings first: their FKs are RESTRICT). */
export async function cleanupRun(prisma: TestPrisma, run: string) {
  const tenants = await prisma.tenant.findMany({ where: { slug: { startsWith: `iso-${run}-` } }, select: { id: true } });
  const ids = tenants.map((t) => t.id);
  await prisma.payment.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.booking.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
  await prisma.user.deleteMany({ where: { email: { contains: `-${run}@` } } });
}

import type { TenantContext } from "@/lib/tenant-context";

/** A TenantContext for one of a fixture shop's two users, built from the database (no HTTP). */
export async function ctxFor(prisma: TestPrisma, shop: ShopFixture, who: "owner" | "staff"): Promise<TenantContext> {
  const u = who === "owner" ? shop.owner : shop.staffUser;
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: shop.tenant.id } });
  return {
    user: { id: u.id, name: u.email, email: u.email },
    tenant,
    tenantId: tenant.id,
    role: who === "owner" ? "OWNER" : "STAFF",
  };
}
