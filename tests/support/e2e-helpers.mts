import { expect, request as pwRequest, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import type { TestPrisma } from "./db.mts";

export const BASE = "http://localhost:3000";
export const PASSWORD = "e2e-test-password";

/** Sign a user up through the real endpoint; the returned context stays logged in. */
export async function signUpApi(prisma: TestPrisma, run: string, label: string) {
  const email = `${label}-${run}@it.example.com`;
  const api = await pwRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { Origin: BASE } });
  const res = await api.post("/api/auth/sign-up/email", { data: { name: label, email, password: PASSWORD } });
  expect(res.ok(), `sign-up ${label}`).toBeTruthy();
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  return { api, id: user.id, email };
}

/** A browser page that carries the same session cookie as an API context. */
export async function pageAs(browser: Browser, api: APIRequestContext): Promise<Page> {
  const ctx = await browser.newContext({ baseURL: BASE, storageState: await api.storageState() });
  return ctx.newPage();
}

/**
 * Label lookup limited to VISIBLE elements. Next 16 keeps previously visited pages mounted but
 * hidden (display:none), so a label like "Price ($)" can match a field on a stale page as well as
 * the current one. Role-based queries ignore hidden elements already; label and text ones do not.
 */
export const byLabel = (page: Page, label: string | RegExp, options?: { exact?: boolean }) =>
  page.getByLabel(label, options).filter({ visible: true });

export const byText = (page: Page, text: string | RegExp, options?: { exact?: boolean }) =>
  page.getByText(text, options).filter({ visible: true });
