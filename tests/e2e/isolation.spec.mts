import { expect, request as pwRequest, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import { createTestPrisma } from "../support/db.mts";
import { cleanupRun, seedShop, type ShopFixture } from "../support/fixtures.mts";

// Two real shops (A and B), real users created through the real sign-up endpoint, and every
// check made over HTTP against the running app: JSON API routes AND rendered dashboard pages.
const BASE = "http://localhost:3000";
const prisma = createTestPrisma();
const run = Math.random().toString(36).slice(2, 8);
const PASSWORD = "isolation-test-pw";

let A: ShopFixture;
let B: ShopFixture;
let ownerA: APIRequestContext; // logged in as shop A's OWNER
let staffA: APIRequestContext; // logged in as shop A's STAFF user
let anon: APIRequestContext;

async function signUp(label: string): Promise<{ api: APIRequestContext; id: string; email: string }> {
  const email = `${label}-${run}@it.example.com`;
  const api = await pwRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { Origin: BASE } });
  const res = await api.post("/api/auth/sign-up/email", { data: { name: label, email, password: PASSWORD } });
  expect(res.ok(), `sign-up ${label}`).toBeTruthy();
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  return { api, id: user.id, email };
}

async function pageAs(browser: Browser, api: APIRequestContext): Promise<Page> {
  const ctx = await browser.newContext({ baseURL: BASE, storageState: await api.storageState() });
  return ctx.newPage();
}

test.beforeAll(async () => {
  const [aOwner, aStaff, bOwner, bStaff] = await Promise.all([
    signUp("a-owner"),
    signUp("a-staff"),
    signUp("b-owner"),
    signUp("b-staff"),
  ]);
  A = await seedShop(prisma, run, "A", { owner: aOwner, staffUser: aStaff });
  B = await seedShop(prisma, run, "B", { owner: bOwner, staffUser: bStaff });
  ownerA = aOwner.api;
  staffA = aStaff.api;
  anon = await pwRequest.newContext({ baseURL: BASE });
});

test.afterAll(async () => {
  await cleanupRun(prisma, run);
  await prisma.$disconnect();
});

const json = { "content-type": "application/json" };

test.describe("tenant isolation (logged in as shop A)", () => {
  test("API: B's booking, service, staff member and customer are 404, with no data in the body", async () => {
    const targets = [
      `/api/bookings/${B.booking.id}`,
      `/api/services/${B.service.id}`,
      `/api/staff/${B.ownerStaff.id}`,
      `/api/staff/${B.ownerStaff.id}/availability`,
      `/api/staff/${B.ownerStaff.id}/time-off`,
      `/api/customers/${B.customer.id}`,
    ];
    for (const url of targets) {
      const res = await ownerA.get(url);
      expect(res.status(), url).toBe(404);
      expect(await res.text(), url).not.toContain(B.marker);
    }
  });

  test("API: A's own rows are reachable (the 404s above are about B, not a broken route)", async () => {
    for (const url of [
      `/api/bookings/${A.booking.id}`,
      `/api/services/${A.service.id}`,
      `/api/staff/${A.ownerStaff.id}`,
      `/api/customers/${A.customer.id}`,
    ]) {
      expect((await ownerA.get(url)).status(), url).toBe(200);
    }
  });

  test("API: no list endpoint ever returns B's rows", async () => {
    for (const url of ["/api/bookings", "/api/services", "/api/staff", "/api/customers"]) {
      const res = await ownerA.get(url);
      expect(res.status(), url).toBe(200);
      const body = await res.text();
      expect(body, url).not.toContain(B.marker);
      expect(body, url).not.toContain(B.tenant.id);
      expect(body, url).toContain(A.marker);
    }
  });

  test("API: writes aimed at B's rows are 404 and change nothing", async () => {
    expect((await ownerA.patch(`/api/services/${B.service.id}`, { data: { name: "HACKED" }, headers: json })).status()).toBe(404);
    expect((await ownerA.patch(`/api/staff/${B.ownerStaff.id}`, { data: { name: "HACKED" }, headers: json })).status()).toBe(404);
    expect((await ownerA.put(`/api/staff/${B.ownerStaff.id}/availability`, { data: [], headers: json })).status()).toBe(404);
    expect(
      (
        await ownerA.post(`/api/staff/${B.ownerStaff.id}/time-off`, {
          data: { startsAt: "2031-01-01T00:00:00Z", endsAt: "2031-01-02T00:00:00Z" },
          headers: json,
        })
      ).status(),
    ).toBe(404);
    expect((await ownerA.delete(`/api/time-off/${B.ownerTimeOff.id}`)).status()).toBe(404);

    expect((await prisma.service.findUniqueOrThrow({ where: { id: B.service.id } })).name).toBe(`${B.marker} Cut`);
    expect((await prisma.staffMember.findUniqueOrThrow({ where: { id: B.ownerStaff.id } })).name).toBe(`${B.marker} Owner Barber`);
    expect(await prisma.availabilityRule.count({ where: { staffId: B.ownerStaff.id } })).toBe(1);
    expect(await prisma.timeOff.count({ where: { id: B.ownerTimeOff.id } })).toBe(1);
  });

  test("API: PATCH /api/settings changes only A's shop", async () => {
    const res = await ownerA.patch("/api/settings", { data: { timezone: "Europe/London" }, headers: json });
    expect(res.status()).toBe(200);
    expect((await prisma.tenant.findUniqueOrThrow({ where: { id: A.tenant.id } })).timezone).toBe("Europe/London");
    expect((await prisma.tenant.findUniqueOrThrow({ where: { id: B.tenant.id } })).timezone).toBe("America/New_York");
  });

  test("pages: B's detail pages render the 404 page and none of B's data", async ({ browser }) => {
    const page = await pageAs(browser, ownerA);
    for (const path of [
      `/dashboard/bookings/${B.booking.id}`,
      `/dashboard/services/${B.service.id}`,
      `/dashboard/staff/${B.ownerStaff.id}`,
      `/dashboard/customers/${B.customer.id}`,
    ]) {
      await page.goto(path);
      await expect(page.getByText("This page could not be found"), path).toBeVisible();
      expect(await page.content(), path).not.toContain(B.marker);
    }
  });

  test("pages: A's detail pages work, and list pages show A's rows but never B's", async ({ browser }) => {
    const page = await pageAs(browser, ownerA);
    await page.goto(`/dashboard/customers/${A.customer.id}`);
    await expect(page.getByRole("heading", { name: `${A.marker} Customer` })).toBeVisible();
    for (const path of ["/dashboard/bookings", "/dashboard/services", "/dashboard/staff", "/dashboard/customers"]) {
      await page.goto(path);
      await expect(page.getByRole("heading").first()).toBeVisible();
      const html = await page.content();
      expect(html, path).toContain(A.marker);
      expect(html, path).not.toContain(B.marker);
    }
  });
});

test.describe("roles: STAFF user of shop A", () => {
  test("API: OWNER-only routes answer 403 (billing, payouts, settings, editing services and staff)", async () => {
    const forbidden: [string, () => Promise<{ status(): number }>][] = [
      ["GET /api/billing", () => staffA.get("/api/billing")],
      ["GET /api/payouts", () => staffA.get("/api/payouts")],
      ["GET /api/settings", () => staffA.get("/api/settings")],
      ["PATCH /api/settings", () => staffA.patch("/api/settings", { data: { name: "Hijack" }, headers: json })],
      ["PATCH /api/services/:id", () => staffA.patch(`/api/services/${A.service.id}`, { data: { name: "x" }, headers: json })],
      ["PATCH /api/staff/:id", () => staffA.patch(`/api/staff/${A.ownerStaff.id}`, { data: { name: "x" }, headers: json })],
    ];
    for (const [label, call] of forbidden) expect((await call()).status(), label).toBe(403);

    expect((await prisma.service.findUniqueOrThrow({ where: { id: A.service.id } })).name).toBe(`${A.marker} Cut`);
    expect((await prisma.tenant.findUniqueOrThrow({ where: { id: A.tenant.id } })).name).toBe(`${A.marker} Shop`);
  });

  test("API: the same routes work for the OWNER (so the 403s are about the role)", async () => {
    expect((await ownerA.get("/api/billing")).status()).toBe(200);
    expect((await ownerA.get("/api/payouts")).status()).toBe(200);
    expect((await ownerA.get("/api/settings")).status()).toBe(200);
    expect((await ownerA.patch(`/api/services/${A.service.id}`, { data: { description: "ok" }, headers: json })).status()).toBe(200);
  });

  test("API: can still read bookings/customers/services/staff (all bookings, read-write default)", async () => {
    for (const url of ["/api/bookings", "/api/customers", "/api/services", "/api/staff"]) {
      expect((await staffA.get(url)).status(), url).toBe(200);
    }
  });

  test("API: signed-out callers get 401", async () => {
    for (const url of ["/api/bookings", "/api/billing", "/api/settings", "/api/staff"]) {
      expect((await anon.get(url)).status(), url).toBe(401);
    }
  });

  test("pages: billing, payouts and settings URLs show the no-access page", async ({ browser }) => {
    const page = await pageAs(browser, staffA);
    for (const path of ["billing", "payouts", "settings"]) {
      await page.goto(`/dashboard/${path}`);
      await expect(page.getByRole("heading", { name: /don.t have access/ }), path).toBeVisible();
    }
  });

  test("API: STAFF can edit their OWN availability and time off", async () => {
    const put = await staffA.put(`/api/staff/${A.staffUserStaff.id}/availability`, {
      data: [{ dayOfWeek: 4, startMinute: 600, endMinute: 900 }],
      headers: json,
    });
    expect(put.status()).toBe(200);
    expect(await prisma.availabilityRule.findMany({ where: { staffId: A.staffUserStaff.id } })).toEqual([
      expect.objectContaining({ dayOfWeek: 4, startMinute: 600, endMinute: 900 }),
    ]);

    const created = await staffA.post(`/api/staff/${A.staffUserStaff.id}/time-off`, {
      data: { startsAt: "2031-06-01T00:00:00Z", endsAt: "2031-06-02T00:00:00Z", reason: "mine" },
      headers: json,
    });
    expect(created.status()).toBe(201);
    const { id } = (await created.json()) as { id: string };
    expect((await staffA.delete(`/api/time-off/${id}`)).status()).toBe(204);
  });

  test("API: STAFF CANNOT edit another staff member's availability or time off (403, data unchanged)", async () => {
    const before = await prisma.availabilityRule.findMany({ where: { staffId: A.ownerStaff.id } });

    const put = await staffA.put(`/api/staff/${A.ownerStaff.id}/availability`, { data: [], headers: json });
    expect(put.status()).toBe(403);
    const post = await staffA.post(`/api/staff/${A.ownerStaff.id}/time-off`, {
      data: { startsAt: "2031-07-01T00:00:00Z", endsAt: "2031-07-02T00:00:00Z" },
      headers: json,
    });
    expect(post.status()).toBe(403);
    expect((await staffA.delete(`/api/time-off/${A.ownerTimeOff.id}`)).status()).toBe(403);

    expect(await prisma.availabilityRule.findMany({ where: { staffId: A.ownerStaff.id } })).toEqual(before);
    expect(await prisma.timeOff.count({ where: { id: A.ownerTimeOff.id } })).toBe(1);
    expect(await prisma.timeOff.count({ where: { staffId: A.ownerStaff.id } })).toBe(1);
  });

  test("API: the OWNER can edit the STAFF user's availability", async () => {
    const res = await ownerA.put(`/api/staff/${A.staffUserStaff.id}/availability`, {
      data: [{ dayOfWeek: 1, startMinute: 540, endMinute: 780 }],
      headers: json,
    });
    expect(res.status()).toBe(200);
  });

  test("API: STAFF of shop A cannot reach shop B either", async () => {
    expect((await staffA.get(`/api/bookings/${B.booking.id}`)).status()).toBe(404);
    expect((await staffA.put(`/api/staff/${B.staffUserStaff.id}/availability`, { data: [], headers: json })).status()).toBe(404);
  });

  test("API: invalid input is a 400 and a rule violation is a 409, never a 500", async () => {
    const bad = await ownerA.put(`/api/staff/${A.ownerStaff.id}/availability`, {
      data: [{ dayOfWeek: 9, startMinute: 700, endMinute: 100 }],
      headers: json,
    });
    expect(bad.status()).toBe(400);
    const rule = await ownerA.patch(`/api/services/${A.service.id}`, { data: { priceCents: 100, depositCents: 900 }, headers: json });
    expect(rule.status()).toBe(409);
  });
});
