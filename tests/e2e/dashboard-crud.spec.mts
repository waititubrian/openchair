import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { createTestPrisma } from "../support/db.mts";
import { byLabel, byText, pageAs, signUpApi } from "../support/e2e-helpers.mts";
import { cleanupRun, seedShop, type ShopFixture } from "../support/fixtures.mts";

// Phase 3 through the real UI: services, staff, weekly hours and time off, as OWNER and STAFF.
// One shop, tests run in order (they build on each other's data).
test.describe.configure({ mode: "serial" });
// The dev server compiles each route on first visit, so cold runs need generous timeouts.
test.setTimeout(60_000);

const prisma = createTestPrisma();
const run = Math.random().toString(36).slice(2, 8);
let S: ShopFixture;
let ownerApi: APIRequestContext;
let staffApi: APIRequestContext;
let owner: Page;
let staff: Page;

const alertWith = (page: Page, text: string | RegExp) => page.getByRole("alert").filter({ hasText: text });

test.beforeAll(async ({ browser }) => {
  const o = await signUpApi(prisma, run, "crud-owner");
  const s = await signUpApi(prisma, run, "crud-staff");
  S = await seedShop(prisma, run, "C", { owner: o, staffUser: s });
  await prisma.tenant.update({ where: { id: S.tenant.id }, data: { plan: "PRO" } });
  ownerApi = o.api;
  staffApi = s.api;
  owner = await pageAs(browser, ownerApi);
  staff = await pageAs(browser, staffApi);
});
test.afterAll(async () => {
  await cleanupRun(prisma, run);
  await prisma.$disconnect();
});

test.describe("services", () => {
  test("OWNER creates, edits, deactivates and deletes a service", async () => {
    await owner.goto("/dashboard/services");
    await owner.getByRole("link", { name: "New service" }).click();

    await byLabel(owner, "Name", { exact: true }).fill("Beard sculpt");
    await byLabel(owner, "Minutes").fill("25");
    await byLabel(owner, "Price ($)").fill("40");
    await byLabel(owner, "Deposit ($)").fill("12.50");
    await byLabel(owner, `${S.marker} Owner Barber`).check();
    await owner.getByRole("button", { name: "Create service" }).click();

    await expect(owner).toHaveURL(/\/dashboard\/services$/);
    await expect(owner.getByRole("link", { name: "Beard sculpt" })).toBeVisible();
    await expect(byText(owner, "25 min · $40.00 · $12.50 deposit")).toBeVisible();
    const created = await prisma.service.findFirstOrThrow({ where: { tenantId: S.tenant.id, name: "Beard sculpt" } });
    expect(created.priceCents).toBe(4000);
    expect(created.depositCents).toBe(1250);
    expect(await prisma.staffService.count({ where: { serviceId: created.id } })).toBe(1);

    // edit
    await owner.getByRole("link", { name: "Beard sculpt" }).click();
    await byLabel(owner, "Price ($)").fill("55");
    await owner.getByRole("button", { name: "Save changes" }).click();
    await expect(owner.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
    expect((await prisma.service.findUniqueOrThrow({ where: { id: created.id } })).priceCents).toBe(5500);

    // a deposit above the price is refused, and what was typed stays on screen
    await byLabel(owner, "Deposit ($)").fill("99");
    await owner.getByRole("button", { name: "Save changes" }).click();
    await expect(alertWith(owner, "Deposit can't exceed the price")).toBeVisible();
    await expect(byLabel(owner, "Deposit ($)")).toHaveValue("99");

    // deactivate
    await byLabel(owner, "Deposit ($)").fill("12.50");
    await byLabel(owner, /Active/).uncheck();
    await owner.getByRole("button", { name: "Save changes" }).click();
    await expect(owner.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
    expect((await prisma.service.findUniqueOrThrow({ where: { id: created.id } })).active).toBe(false);

    // delete (never booked) with the in-page confirmation
    await owner.getByRole("button", { name: "Delete service" }).click();
    await owner.getByRole("button", { name: "Yes, delete" }).click();
    await expect(owner).toHaveURL(/\/dashboard\/services$/);
    await expect(owner.getByRole("link", { name: "Beard sculpt" })).toHaveCount(0);
    expect(await prisma.service.count({ where: { id: created.id } })).toBe(0);
  });

  test("a service that has bookings cannot be deleted", async () => {
    await owner.goto(`/dashboard/services/${S.service.id}`);
    await owner.getByRole("button", { name: "Delete service" }).click();
    await owner.getByRole("button", { name: "Yes, delete" }).click();
    await expect(alertWith(owner, "has bookings")).toBeVisible();
    expect(await prisma.service.count({ where: { id: S.service.id } })).toBe(1);
  });
});

test.describe("staff", () => {
  test("OWNER adds a staff member on the Pro plan", async () => {
    await owner.goto("/dashboard/staff");
    await owner.getByRole("link", { name: "Add staff member" }).click();
    await byLabel(owner, "Name", { exact: true }).fill("Jo Newhire");
    await byLabel(owner, `${S.marker} Cut`).check();
    await owner.getByRole("button", { name: "Add staff member" }).click();
    await expect(owner).toHaveURL(/\/dashboard\/staff$/);
    await expect(owner.getByRole("link", { name: "Jo Newhire" })).toBeVisible();
    const jo = await prisma.staffMember.findFirstOrThrow({ where: { tenantId: S.tenant.id, name: "Jo Newhire" } });
    expect(await prisma.staffService.count({ where: { staffId: jo.id } })).toBe(1);
  });

  test("on the Free plan the add button disappears and a direct attempt is refused", async () => {
    await prisma.tenant.update({ where: { id: S.tenant.id }, data: { plan: "FREE" } });
    await owner.goto("/dashboard/staff");
    await expect(owner.getByRole("link", { name: "Add staff member" })).toHaveCount(0);
    await expect(owner.getByRole("note")).toContainText("Upgrade to Pro");

    // bypass the hidden button: the server still says no
    await owner.goto("/dashboard/staff/new");
    await byLabel(owner, "Name", { exact: true }).fill("Sneaky");
    await owner.getByRole("button", { name: "Add staff member" }).click();
    await expect(alertWith(owner, "Upgrade to Pro")).toBeVisible();
    expect(await prisma.staffMember.count({ where: { tenantId: S.tenant.id, name: "Sneaky" } })).toBe(0);

    const api = await ownerApi.post("/api/staff", { data: { name: "Sneaky API" }, headers: { "content-type": "application/json" } });
    expect(api.status()).toBe(402);
    await prisma.tenant.update({ where: { id: S.tenant.id }, data: { plan: "PRO" } });
  });

  test("OWNER renames and deactivates a person; one with bookings cannot be deleted", async () => {
    await owner.goto(`/dashboard/staff/${S.staffUserStaff.id}`);
    await byLabel(owner, "Name", { exact: true }).fill("Renamed Barber");
    await owner.getByRole("button", { name: "Save changes" }).click();
    await expect(owner.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
    expect((await prisma.staffMember.findUniqueOrThrow({ where: { id: S.staffUserStaff.id } })).name).toBe("Renamed Barber");

    await owner.goto(`/dashboard/staff/${S.ownerStaff.id}`); // has a booking in the fixture
    await owner.getByRole("button", { name: "Delete staff member" }).click();
    await owner.getByRole("button", { name: "Yes, delete" }).click();
    await expect(alertWith(owner, "has bookings")).toBeVisible();
  });
});

test.describe("weekly hours and time off", () => {
  test("OWNER edits hours, including a split shift, and they persist", async () => {
    await owner.goto(`/dashboard/staff/${S.ownerStaff.id}`);
    await owner.getByRole("button", { name: "Open Monday" }).click();
    await byLabel(owner, "Monday opens, interval 1").fill("10:00");
    // split Tuesday: keep 09:00-17:00, add 18:00-20:00
    await owner.getByRole("button", { name: "Add hours on Tuesday" }).click();
    await byLabel(owner, "Tuesday opens, interval 2").fill("18:00");
    await byLabel(owner, "Tuesday closes, interval 2").fill("20:00");
    await owner.getByRole("button", { name: "Save weekly hours" }).click();
    await expect(owner.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();

    const rules = await prisma.availabilityRule.findMany({
      where: { staffId: S.ownerStaff.id },
      orderBy: [{ dayOfWeek: "asc" }, { startMinute: "asc" }],
    });
    expect(rules.map((r) => [r.dayOfWeek, r.startMinute, r.endMinute])).toEqual([
      [1, 600, 1020],
      [2, 540, 1020],
      [2, 1080, 1200],
    ]);

    await owner.reload();
    await expect(byLabel(owner, "Monday opens, interval 1")).toHaveValue("10:00");
    await expect(byLabel(owner, "Tuesday closes, interval 2")).toHaveValue("20:00");
  });

  test("overlapping hours are refused with a readable message", async () => {
    await owner.goto(`/dashboard/staff/${S.ownerStaff.id}`);
    await byLabel(owner, "Tuesday opens, interval 2").fill("16:00"); // overlaps 09:00-17:00
    await owner.getByRole("button", { name: "Save weekly hours" }).click();
    await expect(alertWith(owner, "can't overlap")).toBeVisible();
    expect(await prisma.availabilityRule.count({ where: { staffId: S.ownerStaff.id, dayOfWeek: 2 } })).toBe(2); // unchanged
  });

  test("OWNER adds time off in the shop's timezone, sees it, and removes it", async () => {
    await owner.goto(`/dashboard/staff/${S.ownerStaff.id}`);
    await byLabel(owner, "From").fill("2031-07-01T09:00");
    await byLabel(owner, "Until").fill("2031-07-01T17:00");
    await byLabel(owner, "Reason (optional)").fill("Holiday");
    await owner.getByRole("button", { name: "Add time off" }).click();

    const item = owner.getByRole("listitem").filter({ hasText: "Holiday" });
    await expect(item).toContainText("9:00 AM"); // shown back in the shop's timezone
    const row = await prisma.timeOff.findFirstOrThrow({ where: { staffId: S.ownerStaff.id, reason: "Holiday" } });
    expect(row.startsAt.toISOString()).toBe("2031-07-01T13:00:00.000Z"); // 09:00 New York (EDT) = 13:00 UTC

    await item.getByRole("button", { name: "Remove" }).click();
    await expect(owner.getByRole("listitem").filter({ hasText: "Holiday" })).toHaveCount(0);
    expect(await prisma.timeOff.count({ where: { id: row.id } })).toBe(0);
  });
});

test.describe("STAFF user", () => {
  test("is taken straight to their own schedule and can edit it", async () => {
    await staff.goto("/dashboard/availability");
    await expect(staff).toHaveURL(new RegExp(`/dashboard/staff/${S.staffUserStaff.id}`));
    await staff.getByRole("button", { name: "Open Monday" }).click();
    await staff.getByRole("button", { name: "Save weekly hours" }).click();
    await expect(staff.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
    expect(await prisma.availabilityRule.count({ where: { staffId: S.staffUserStaff.id, dayOfWeek: 1 } })).toBe(1);
    await expect(staff.getByRole("button", { name: "Save changes" })).toHaveCount(0); // no profile form for STAFF
  });

  test("sees a colleague's schedule read-only, with no editor", async () => {
    await staff.goto(`/dashboard/staff/${S.ownerStaff.id}`);
    await expect(byText(staff, /Only the owner or .* can change these hours/)).toBeVisible();
    await expect(staff.getByRole("button", { name: "Save weekly hours" })).toHaveCount(0);
    await expect(staff.getByRole("button", { name: "Add time off" })).toHaveCount(0);
  });

  test("has no way into owner-only forms, by link or by URL", async () => {
    await staff.goto("/dashboard/services");
    await expect(staff.getByRole("link", { name: "New service" })).toHaveCount(0);
    await staff.goto("/dashboard/staff");
    await expect(staff.getByRole("link", { name: "Add staff member" })).toHaveCount(0);
    for (const path of ["/dashboard/services/new", "/dashboard/staff/new"]) {
      await staff.goto(path);
      await expect(staff.getByRole("heading", { name: /don.t have access/ }), path).toBeVisible();
    }
  });

  test("direct API calls to owner-only endpoints are 403", async () => {
    const json = { "content-type": "application/json" };
    expect((await staffApi.post("/api/services", { data: { name: "x", durationMin: 30, priceCents: 1, depositCents: 0 }, headers: json })).status()).toBe(403);
    expect((await staffApi.delete(`/api/services/${S.service.id}`)).status()).toBe(403);
    expect((await staffApi.post("/api/staff", { data: { name: "x" }, headers: json })).status()).toBe(403);
    expect((await staffApi.delete(`/api/staff/${S.ownerStaff.id}`)).status()).toBe(403);
  });
});
