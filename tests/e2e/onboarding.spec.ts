import { expect, test } from "@playwright/test";

const unique = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

test("a new owner signs up and onboards a shop", async ({ page }) => {
  const id = unique();
  const shopName = `E2E Barbers ${id}`;

  // Sign up
  await page.goto("/signup");
  await page.getByLabel("Your name").fill("Erin Example");
  await page.getByLabel("Email").fill(`erin+${id}@example.com`);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();

  // Wizard step 1: shop. The slug is derived from the name and checked for availability.
  await expect(page).toHaveURL(/\/onboarding/);
  await page.getByLabel("Shop name").fill(shopName);
  await expect(page.getByText("available ✓")).toBeVisible();
  await page.getByRole("button", { name: "Next", exact: true }).click();

  // Step 2: first service (defaults are valid)
  await expect(page.getByLabel("Service name")).toHaveValue("Haircut");
  await page.getByRole("button", { name: "Next", exact: true }).click();

  // Step 3: weekly hours (Mon-Fri 09:00-17:00 by default)
  await expect(page.getByLabel("Monday opens")).toHaveValue("09:00");
  await page.getByRole("button", { name: "Create my shop" }).click();

  // Lands on the dashboard for the new shop, as OWNER, with the public link.
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { name: "Welcome, Erin" })).toBeVisible();
  await expect(page.getByText(shopName).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Billing" })).toBeVisible();

  // Finishing onboarding twice is not possible: /onboarding bounces to the dashboard.
  await page.goto("/onboarding");
  await expect(page).toHaveURL(/\/dashboard$/);
});

test("shows an error when the web address is taken", async ({ page }) => {
  const id = unique();
  await page.goto("/signup");
  await page.getByLabel("Your name").fill("Sam Taken");
  await page.getByLabel("Email").fill(`sam+${id}@example.com`);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/);

  await page.getByLabel("Shop name").fill("Fade and Co"); // slug "fade-and-co" belongs to the seeded demo shop
  await expect(page.getByText("That web address is taken").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Next", exact: true })).toBeDisabled();
});

test("signed-out visitors are sent to log in, and bad passwords are rejected", async ({ page }) => {
  await page.goto("/dashboard/bookings");
  await expect(page).toHaveURL(/\/login\?next=%2Fdashboard%2Fbookings/);

  await page.getByLabel("Email").fill("owner@demo.openchair.dev");
  await page.getByLabel("Password").fill("wrong-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Incorrect" })).toContainText("Incorrect email or password");

  await page.getByLabel("Password").fill("openchair-demo");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard\/bookings$/); // returned to where they were headed
});
