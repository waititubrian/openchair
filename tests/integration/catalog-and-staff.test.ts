import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ConflictError, ForbiddenError, NotFoundError, PlanLimitError, ValidationError } from "@/lib/errors";
import type { TenantContext } from "@/lib/tenant-context";
import * as availabilityService from "@/services/availability.service";
import * as catalogService from "@/services/catalog.service";
import * as staffService from "@/services/staff.service";
import { createTestPrisma } from "../support/db.mts";
import { cleanupRun, ctxFor, seedShop, type ShopFixture } from "../support/fixtures.mts";

// Phase 3 rules at the service level, against the real database.
const prisma = createTestPrisma();
const run = Math.random().toString(36).slice(2, 8);
let A: ShopFixture; // PRO shop (no staff limit)
let B: ShopFixture;
let F: ShopFixture; // FREE shop (1 active staff)
let ownerA: TenantContext;
let staffA: TenantContext;
let ownerB: TenantContext;
let ownerF: TenantContext;

const user = (label: string) => prisma.user.create({ data: { email: `${label}-${run}@it.example.com`, name: label } });

beforeAll(async () => {
  A = await seedShop(prisma, run, "A", { owner: await user("a-owner"), staffUser: await user("a-staff") });
  B = await seedShop(prisma, run, "B", { owner: await user("b-owner"), staffUser: await user("b-staff") });
  F = await seedShop(prisma, run, "F", { owner: await user("f-owner"), staffUser: await user("f-staff") });
  await prisma.tenant.update({ where: { id: A.tenant.id }, data: { plan: "PRO" } });
  await prisma.tenant.update({ where: { id: B.tenant.id }, data: { plan: "PRO" } });
  ownerA = await ctxFor(prisma, A, "owner");
  staffA = await ctxFor(prisma, A, "staff");
  ownerB = await ctxFor(prisma, B, "owner");
  ownerF = await ctxFor(prisma, F, "owner");
});
afterAll(async () => {
  await cleanupRun(prisma, run);
  await prisma.$disconnect();
});

const input = (over: Record<string, unknown> = {}) => ({
  name: "Beard trim",
  description: null,
  durationMin: 20,
  priceCents: 2000,
  depositCents: 500,
  active: true,
  staffIds: [] as string[],
  ...over,
});

describe("services (catalog)", () => {
  it("creates a service and assigns it to staff", async () => {
    const s = await catalogService.createService(ownerA, input({ staffIds: [A.ownerStaff.id, A.staffUserStaff.id] }));
    expect(s.staffIds.sort()).toEqual([A.ownerStaff.id, A.staffUserStaff.id].sort());
    expect(s.priceCents).toBe(2000);
  });

  it("rejects assigning ANOTHER shop's staff member (nothing is created)", async () => {
    const before = await prisma.service.count({ where: { tenantId: A.tenant.id } });
    await expect(catalogService.createService(ownerA, input({ name: "X", staffIds: [B.ownerStaff.id] }))).rejects.toBeInstanceOf(NotFoundError);
    expect(await prisma.service.count({ where: { tenantId: A.tenant.id } })).toBe(before); // rolled back
  });

  it("rejects a deposit above the price, on create and on update", async () => {
    await expect(catalogService.createService(ownerA, input({ priceCents: 1000, depositCents: 2000 }))).rejects.toBeInstanceOf(ConflictError);
    await expect(catalogService.updateService(ownerA, A.service.id, { depositCents: 99_999 })).rejects.toBeInstanceOf(ConflictError);
  });

  it("update replaces who offers the service", async () => {
    const s = await catalogService.createService(ownerA, input({ name: "Swap", staffIds: [A.ownerStaff.id] }));
    const updated = await catalogService.updateService(ownerA, s.id, { staffIds: [A.staffUserStaff.id], name: "Swapped" });
    expect(updated.staffIds).toEqual([A.staffUserStaff.id]);
    expect(updated.name).toBe("Swapped");
  });

  it("cannot delete a service that has bookings (409), but can delete an unused one", async () => {
    await expect(catalogService.deleteService(ownerA, A.service.id)).rejects.toMatchObject({ code: "HAS_BOOKINGS" });
    expect(await prisma.service.count({ where: { id: A.service.id } })).toBe(1);

    const unused = await catalogService.createService(ownerA, input({ name: "Unused" }));
    await catalogService.deleteService(ownerA, unused.id);
    expect(await prisma.service.count({ where: { id: unused.id } })).toBe(0);
  });

  it("STAFF can read but not write", async () => {
    expect((await catalogService.listServices(staffA)).length).toBeGreaterThan(0);
    await expect(catalogService.createService(staffA, input())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(catalogService.deleteService(staffA, A.service.id)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("staff members and the Free plan limit", () => {
  it("Free plan: a shop already at its limit cannot add another active staff member (402)", async () => {
    // F's fixture has 2 active staff members already (above the Free limit of 1)
    await expect(staffService.createStaffMember(ownerF, { name: "Extra", serviceIds: [] })).rejects.toBeInstanceOf(PlanLimitError);
    expect(await prisma.staffMember.count({ where: { tenantId: F.tenant.id, name: "Extra" } })).toBe(0);
  });

  it("Free plan: reactivating an inactive person also counts against the limit", async () => {
    await prisma.staffMember.update({ where: { id: F.staffUserStaff.id }, data: { active: false } });
    await prisma.staffMember.update({ where: { id: F.ownerStaff.id }, data: { active: false } });
    // 0 active -> adding one is fine (1 of 1)
    const first = await staffService.createStaffMember(ownerF, { name: "Only one", serviceIds: [] });
    // now at the limit: reactivating anyone else is refused, adding is refused
    await expect(staffService.updateStaffMember(ownerF, F.ownerStaff.id, { active: true })).rejects.toBeInstanceOf(PlanLimitError);
    await expect(staffService.createStaffMember(ownerF, { name: "Second", serviceIds: [] })).rejects.toBeInstanceOf(PlanLimitError);
    // deactivating frees the slot again
    await staffService.updateStaffMember(ownerF, first.id, { active: false });
    await expect(staffService.updateStaffMember(ownerF, F.ownerStaff.id, { active: true })).resolves.toMatchObject({ active: true });
  });

  it("Pro plan: no limit", async () => {
    for (const n of ["P1", "P2", "P3"]) await staffService.createStaffMember(ownerA, { name: n, serviceIds: [] });
    expect((await prisma.staffMember.count({ where: { tenantId: A.tenant.id, active: true } })) >= 5).toBe(true);
  });

  it("creating staff with services assigns them; a foreign service id is refused", async () => {
    const m = await staffService.createStaffMember(ownerA, { name: "With svc", serviceIds: [A.service.id] });
    expect(m.serviceIds).toEqual([A.service.id]);
    await expect(staffService.createStaffMember(ownerA, { name: "Bad", serviceIds: [B.service.id] })).rejects.toBeInstanceOf(NotFoundError);
    expect(await prisma.staffMember.count({ where: { tenantId: A.tenant.id, name: "Bad" } })).toBe(0);
  });

  it("cannot delete a staff member with bookings (409); can delete one without", async () => {
    await expect(staffService.deleteStaffMember(ownerA, A.ownerStaff.id)).rejects.toMatchObject({ code: "HAS_BOOKINGS" });
    const spare = await staffService.createStaffMember(ownerA, { name: "Spare", serviceIds: [] });
    await staffService.deleteStaffMember(ownerA, spare.id);
    expect(await prisma.staffMember.count({ where: { id: spare.id } })).toBe(0);
  });

  it("deleting a person removes their hours and time off with them", async () => {
    const m = await staffService.createStaffMember(ownerA, { name: "Temp", serviceIds: [] });
    await availabilityService.replaceWeekly(ownerA, m.id, [{ dayOfWeek: 1, startMinute: 540, endMinute: 600 }]);
    await availabilityService.addTimeOff(ownerA, m.id, { startsAt: "2031-01-01T00:00:00Z", endsAt: "2031-01-02T00:00:00Z" });
    await staffService.deleteStaffMember(ownerA, m.id);
    expect(await prisma.availabilityRule.count({ where: { staffId: m.id } })).toBe(0);
    expect(await prisma.timeOff.count({ where: { staffId: m.id } })).toBe(0);
  });

  it("cannot touch another shop's staff member", async () => {
    await expect(staffService.updateStaffMember(ownerA, B.ownerStaff.id, { name: "x" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(staffService.deleteStaffMember(ownerA, B.ownerStaff.id)).rejects.toBeInstanceOf(NotFoundError);
    expect(await prisma.staffMember.count({ where: { id: B.ownerStaff.id } })).toBe(1);
  });

  it("STAFF cannot add, edit or delete staff members", async () => {
    await expect(staffService.createStaffMember(staffA, { name: "No", serviceIds: [] })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(staffService.updateStaffMember(staffA, A.ownerStaff.id, { name: "No" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(staffService.deleteStaffMember(staffA, A.ownerStaff.id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("getOwnStaffMember finds the staff member linked to the signed-in user", async () => {
    expect((await staffService.getOwnStaffMember(staffA))?.id).toBe(A.staffUserStaff.id);
  });
});

describe("time off is entered in the SHOP's timezone and stored as UTC", () => {
  it("converts New York wall-clock time to UTC, following daylight saving", async () => {
    // shop timezone is America/New_York. July = EDT (UTC-4); January = EST (UTC-5).
    const summer = await availabilityService.addTimeOffLocal(ownerA, A.ownerStaff.id, { startLocal: "2031-07-01T09:00", endLocal: "2031-07-01T17:00" });
    expect(summer.startsAt.toISOString()).toBe("2031-07-01T13:00:00.000Z");
    expect(summer.endsAt.toISOString()).toBe("2031-07-01T21:00:00.000Z");
    const winter = await availabilityService.addTimeOffLocal(ownerA, A.ownerStaff.id, { startLocal: "2031-01-15T09:00", endLocal: "2031-01-15T17:00" });
    expect(winter.startsAt.toISOString()).toBe("2031-01-15T14:00:00.000Z");
  });

  it("rejects an end before the start", async () => {
    await expect(
      availabilityService.addTimeOffLocal(ownerA, A.ownerStaff.id, { startLocal: "2031-07-02T17:00", endLocal: "2031-07-02T09:00" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("STAFF can add time off for themselves but not for a colleague", async () => {
    await expect(
      availabilityService.addTimeOffLocal(staffA, A.staffUserStaff.id, { startLocal: "2031-08-01T09:00", endLocal: "2031-08-01T10:00" }),
    ).resolves.toBeTruthy();
    await expect(
      availabilityService.addTimeOffLocal(staffA, A.ownerStaff.id, { startLocal: "2031-08-01T09:00", endLocal: "2031-08-01T10:00" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("cross-shop writes through the new functions", () => {
  it("shop B's owner cannot edit or delete shop A's service", async () => {
    await expect(catalogService.updateService(ownerB, A.service.id, { name: "HACK" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(catalogService.deleteService(ownerB, A.service.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await prisma.service.findUniqueOrThrow({ where: { id: A.service.id } })).name).toBe(`${A.marker} Cut`);
  });
});
