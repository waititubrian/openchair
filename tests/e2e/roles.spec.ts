import { expect, test, type Page } from "@playwright/test";

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("openchair-demo");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

test("STAFF cannot reach billing, payouts or settings", async ({ page }) => {
  await signIn(page, "dee@demo.openchair.dev");
  const nav = page.getByRole("navigation", { name: "Dashboard" });
  await expect(nav.getByRole("link", { name: "Bookings" })).toBeVisible();
  for (const hidden of ["Billing", "Payouts", "Settings"]) {
    await expect(nav.getByRole("link", { name: hidden })).toHaveCount(0);
  }
  for (const path of ["billing", "payouts", "settings"]) {
    await page.goto(`/dashboard/${path}`);
    await expect(page.getByRole("heading", { name: /don.t have access/ })).toBeVisible();
  }
});

test("OWNER sees billing but is not a platform admin", async ({ page }) => {
  await signIn(page, "owner@demo.openchair.dev");
  await expect(page.getByRole("navigation", { name: "Dashboard" }).getByRole("link", { name: "Billing" })).toBeVisible();
  await page.goto("/dashboard/billing");
  await expect(page.getByRole("heading", { name: "Billing" })).toBeVisible();
  const res = await page.goto("/admin");
  await expect(page.getByText("This page could not be found")).toBeVisible();
  expect(res?.status()).toBeLessThan(500);
});

test("PLATFORM_ADMIN reaches /admin", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("admin@openchair.dev");
  await page.getByLabel("Password").fill("openchair-demo");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/onboarding/); // the admin has no shop; wait for sign-in to finish
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Platform admin" })).toBeVisible();
});
