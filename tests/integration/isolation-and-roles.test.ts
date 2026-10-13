import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import type { TenantContext } from "@/lib/tenant-context";
import * as availabilityService from "@/services/availability.service";
import * as bookingService from "@/services/booking.service";
import * as catalogService from "@/services/catalog.service";
import * as customerService from "@/services/customer.service";
import * as staffService from "@/services/staff.service";
import { createTestPrisma } from "../support/db.mts";
import { cleanupRun, seedShop, type ShopFixture } from "../support/fixtures.mts";

// Service-level proof of tenant isolation and role rules, against the real database.
// (The same properties are re-checked through real HTTP pages/APIs in tests/e2e/isolation.spec.ts.)
const prisma = createTestPrisma();
const run = Math.random().toString(36).slice(2, 8);
let A: ShopFixture;
let B: ShopFixture;

async function user(label: string) {
  return prisma.user.create({ data: { email: `${label}-${run}@it.example.com`, name: label } });
}
async function ctxFor(shop: ShopFixture, who: "owner" | "staff"): Promise<TenantContext> {
  const u = who === "owner" ? shop.owner : shop.staffUser;
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: shop.tenant.id } });
  return {
    user: { id: u.id, name: u.email, email: u.email },
    tenant,
    tenantId: tenant.id,
    role: who === "owner" ? "OWNER" : "STAFF",
  };
}

let ownerA: TenantContext;
let staffA: TenantContext;

beforeAll(async () => {
  A = await seedShop(prisma, run, "A", { owner: await user("a-owner"), staffUser: await user("a-staff") });
  B = await seedShop(prisma, run, "B", { owner: await user("b-owner"), staffUser: await user("b-staff") });
  ownerA = await ctxFor(A, "owner");
  staffA = await ctxFor(A, "staff");
});
afterAll(async () => {
  await cleanupRun(prisma, run);
  await prisma.$disconnect();
});

describe("tenant isolation: shop A's OWNER cannot see or touch shop B's rows", () => {
  it("get-by-id of B's booking, service, staff member and customer is NotFound", async () => {
    await expect(bookingService.getBooking(ownerA, B.booking.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(catalogService.getService(ownerA, B.service.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(staffService.getStaffMember(ownerA, B.ownerStaff.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(customerService.getCustomer(ownerA, B.customer.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("list functions return only A's rows, never B's", async () => {
    const [bookings, services, staff, customers] = await Promise.all([
      bookingService.listBookings(ownerA),
      catalogService.listServices(ownerA),
      staffService.listStaff(ownerA),
      customerService.listCustomers(ownerA),
    ]);
    expect(bookings.map((b) => b.id)).toEqual([A.booking.id]);
    expect(services.map((s) => s.id)).toEqual([A.service.id]);
    expect(staff.map((s) => s.id).sort()).toEqual([A.ownerStaff.id, A.staffUserStaff.id].sort());
    expect(customers.map((c) => c.id)).toEqual([A.customer.id]);
    expect(JSON.stringify([bookings, services, staff, customers])).not.toContain(B.marker);
  });

  it("writes aimed at B's rows fail and change nothing", async () => {
    await expect(catalogService.updateService(ownerA, B.service.id, { name: "HACKED" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(staffService.updateStaffMember(ownerA, B.ownerStaff.id, { name: "HACKED" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(availabilityService.replaceWeekly(ownerA, B.ownerStaff.id, [])).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      availabilityService.addTimeOff(ownerA, B.ownerStaff.id, { startsAt: "2031-01-01T00:00:00Z", endsAt: "2031-01-02T00:00:00Z" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(availabilityService.removeTimeOff(ownerA, B.ownerTimeOff.id)).rejects.toBeInstanceOf(NotFoundError);

    expect((await prisma.service.findUniqueOrThrow({ where: { id: B.service.id } })).name).toBe(`${B.marker} Cut`);
    expect((await prisma.staffMember.findUniqueOrThrow({ where: { id: B.ownerStaff.id } })).name).toBe(`${B.marker} Owner Barber`);
    expect(await prisma.availabilityRule.count({ where: { staffId: B.ownerStaff.id } })).toBe(1);
    expect(await prisma.timeOff.count({ where: { id: B.ownerTimeOff.id } })).toBe(1);
  });

  it("the database itself refuses cross-tenant references (composite FKs)", async () => {
    // A booking in shop A that points at shop B's service must be rejected by Postgres.
    await expect(
      prisma.booking.create({
        data: {
          tenantId: A.tenant.id,
          serviceId: B.service.id,
          staffId: A.ownerStaff.id,
          customerId: A.customer.id,
          startsAt: new Date("2031-05-01T10:00:00Z"),
          endsAt: new Date("2031-05-01T10:30:00Z"),
          priceCents: 1,
          depositCents: 0,
        },
      }),
    ).rejects.toThrow();
  });
});

describe("roles: STAFF", () => {
  it("cannot use OWNER-only service functions", async () => {
    await expect(catalogService.updateService(staffA, A.service.id, { name: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(staffService.updateStaffMember(staffA, A.ownerStaff.id, { name: "x" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("can read bookings, customers, services and staff (all bookings, per the agreed default)", async () => {
    expect(await bookingService.listBookings(staffA)).toHaveLength(1);
    expect(await customerService.listCustomers(staffA)).toHaveLength(1);
    expect(await catalogService.listServices(staffA)).toHaveLength(1);
    expect(await staffService.listStaff(staffA)).toHaveLength(2);
  });

  it("can edit their OWN availability and time off", async () => {
    const rules = await availabilityService.replaceWeekly(staffA, A.staffUserStaff.id, [
      { dayOfWeek: 3, startMinute: 600, endMinute: 900 },
    ]);
    expect(rules).toEqual([{ dayOfWeek: 3, startMinute: 600, endMinute: 900 }]);

    const off = await availabilityService.addTimeOff(staffA, A.staffUserStaff.id, {
      startsAt: "2031-02-01T00:00:00Z",
      endsAt: "2031-02-02T00:00:00Z",
      reason: "mine",
    });
    await availabilityService.removeTimeOff(staffA, off.id);
    await availabilityService.removeTimeOff(staffA, A.staffUserTimeOff.id);
    expect(await prisma.timeOff.count({ where: { id: A.staffUserTimeOff.id } })).toBe(0);
  });

  it("CANNOT edit another staff member's availability or time off (even in the same shop)", async () => {
    await expect(availabilityService.replaceWeekly(staffA, A.ownerStaff.id, [])).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      availabilityService.addTimeOff(staffA, A.ownerStaff.id, { startsAt: "2031-03-01T00:00:00Z", endsAt: "2031-03-02T00:00:00Z" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(availabilityService.removeTimeOff(staffA, A.ownerTimeOff.id)).rejects.toBeInstanceOf(ForbiddenError);

    // nothing changed
    expect(await prisma.availabilityRule.count({ where: { staffId: A.ownerStaff.id } })).toBe(1);
    expect(await prisma.timeOff.count({ where: { id: A.ownerTimeOff.id } })).toBe(1);
  });
});

describe("roles: OWNER manages everyone's availability", () => {
  it("can replace the STAFF user's hours and add/remove their time off", async () => {
    const rules = await availabilityService.replaceWeekly(ownerA, A.staffUserStaff.id, [
      { dayOfWeek: 5, startMinute: 480, endMinute: 720 },
    ]);
    expect(rules).toHaveLength(1);
    const off = await availabilityService.addTimeOff(ownerA, A.staffUserStaff.id, {
      startsAt: "2031-04-01T00:00:00Z",
      endsAt: "2031-04-02T00:00:00Z",
    });
    await availabilityService.removeTimeOff(ownerA, off.id);
  });
});

describe("memberships: a user can belong to more than one shop", () => {
  it("allows the same user in shops A and B with different roles, but only once per shop", async () => {
    const traveller = await user("traveller");
    await prisma.membership.create({ data: { userId: traveller.id, tenantId: A.tenant.id, role: "STAFF" } });
    await prisma.membership.create({ data: { userId: traveller.id, tenantId: B.tenant.id, role: "OWNER" } });
    const rows = await prisma.membership.findMany({ where: { userId: traveller.id }, orderBy: { role: "asc" } });
    expect(rows.map((r) => [r.tenantId, r.role]).sort()).toEqual(
      [[A.tenant.id, "STAFF"], [B.tenant.id, "OWNER"]].sort(),
    );
    await expect(
      prisma.membership.create({ data: { userId: traveller.id, tenantId: A.tenant.id, role: "OWNER" } }),
    ).rejects.toThrow(); // unique (userId, tenantId)
  });
});
