import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { createTestPrisma } from "../support/db.mts";

// Google sign-in wiring, checked without calling Google: we build the auth instance with
// placeholder credentials and inspect what it would send / how it reacts. A real end-to-end
// Google login needs real credentials and a browser, so it is verified by hand (see README).
const ORIGIN = "http://localhost:3000";

async function loadAuth(creds: { id: string; secret: string }) {
  vi.resetModules(); // env.ts and auth.ts read process.env at import time
  vi.stubEnv("GOOGLE_CLIENT_ID", creds.id);
  vi.stubEnv("GOOGLE_CLIENT_SECRET", creds.secret);
  vi.stubEnv("APP_URL", ORIGIN);
  return import("@/lib/auth");
}

const startGoogle = (auth: { handler: (r: Request) => Promise<Response> }) =>
  auth.handler(
    new Request(`${ORIGIN}/api/auth/sign-in/social`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({ provider: "google", callbackURL: "/dashboard" }),
    }),
  );

afterEach(() => vi.unstubAllEnvs());

describe("Google sign-in", () => {
  it("is enabled only when both credentials are set", async () => {
    expect((await loadAuth({ id: "x.apps.googleusercontent.com", secret: "s" })).googleEnabled).toBe(true);
    expect((await loadAuth({ id: "x.apps.googleusercontent.com", secret: "" })).googleEnabled).toBe(false);
    expect((await loadAuth({ id: "", secret: "" })).googleEnabled).toBe(false);
  });

  it("without credentials the provider does not exist (400, not a crash)", async () => {
    const { auth } = await loadAuth({ id: "", secret: "" });
    const res = await startGoogle(auth);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(await res.text()).toContain("PROVIDER_NOT_FOUND");
  });

  it("with credentials, sends the user to Google with the right callback and an account picker", async () => {
    const { auth } = await loadAuth({ id: "test-client.apps.googleusercontent.com", secret: "test-secret" });
    const res = await startGoogle(auth);
    expect(res.status).toBe(200);
    const { url } = (await res.json()) as { url: string };
    const google = new URL(url);
    expect(google.origin + google.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(google.searchParams.get("client_id")).toBe("test-client.apps.googleusercontent.com");
    // This exact value must be listed under "Authorized redirect URIs" in Google Cloud Console.
    expect(google.searchParams.get("redirect_uri")).toBe(`${ORIGIN}/api/auth/callback/google`);
    expect(google.searchParams.get("prompt")).toBe("select_account");
    expect(google.searchParams.get("response_type")).toBe("code");
    expect(google.searchParams.get("scope")).toContain("email");
    expect(google.searchParams.get("state")).toBeTruthy(); // CSRF protection
  });

  it("a failed or forged callback lands on OUR login page, not a bare error page", async () => {
    const { auth } = await loadAuth({ id: "test-client.apps.googleusercontent.com", secret: "test-secret" });
    const res = await auth.handler(new Request(`${ORIGIN}/api/auth/callback/google?code=x&state=forged`));
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("location")!, ORIGIN);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("error")).toBeTruthy();
  });
});

// ---- account linking -------------------------------------------------------------------
// Simulates Google vouching for an email by replacing token verification and profile lookup,
// so the real linking logic runs against the real database without calling Google.
const prisma = createTestPrisma();
const run = Math.random().toString(36).slice(2, 8);
afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { contains: `-${run}@` } } });
  await prisma.$disconnect();
});

async function googleAs(email: string, sub: string) {
  vi.resetModules();
  vi.stubEnv("GOOGLE_CLIENT_ID", "test-client.apps.googleusercontent.com");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "test-secret");
  vi.stubEnv("APP_URL", ORIGIN);
  const { createAuth } = await import("@/lib/auth");
  const auth = createAuth({
    googleOverrides: {
      verifyIdToken: async () => true,
      // Only the fields the linking logic reads; cast because GoogleProfile has many more.
      getUserInfo: async () =>
        ({
          user: { id: sub, email, name: "Google Person", emailVerified: true, image: undefined },
          data: { sub },
        }) as never,
    },
  });
  return auth.handler(
    new Request(`${ORIGIN}/api/auth/sign-in/social`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({ provider: "google", idToken: { token: "fake-id-token" } }),
    }),
  );
}

describe("Google account linking", () => {
  it("creates a new user (email verified, no password, no shop yet) for an unknown email", async () => {
    const email = `new-${run}@it.example.com`;
    const res = await googleAs(email, `sub-new-${run}`);
    expect(res.status).toBe(200);
    const user = await prisma.user.findUniqueOrThrow({ where: { email }, include: { accounts: true, memberships: true } });
    expect(user.emailVerified).toBe(true);
    expect(user.accounts.map((a) => [a.providerId, a.password])).toEqual([["google", null]]);
    expect(user.memberships).toHaveLength(0); // so the dashboard will send them to /onboarding
  });

  it("recognises a returning Google user instead of creating a duplicate", async () => {
    const email = `again-${run}@it.example.com`;
    await googleAs(email, `sub-again-${run}`);
    const second = await googleAs(email, `sub-again-${run}`);
    expect(second.status).toBe(200);
    expect(await prisma.user.count({ where: { email } })).toBe(1);
    expect(await prisma.account.count({ where: { user: { email }, providerId: "google" } })).toBe(1);
  });

  it("REFUSES to merge Google into a password account whose email is unverified (pre-account-takeover guard)", async () => {
    // The squatter: signed up with the victim's email and their own password; email never verified.
    const email = `victim-${run}@it.example.com`;
    const squatter = await prisma.user.create({ data: { email, name: "Squatter", emailVerified: false } });
    await prisma.account.create({
      data: { userId: squatter.id, providerId: "credential", accountId: squatter.id, password: "scrypt$00$00" },
    });

    // The real owner now clicks "Continue with Google" (Google vouches for the email).
    const res = await googleAs(email, `sub-victim-${run}`);

    expect(res.status).toBe(401);
    expect(await res.text()).toMatch(/not linked/i);
    const accounts = await prisma.account.findMany({ where: { userId: squatter.id } });
    expect(accounts.map((a) => a.providerId)).toEqual(["credential"]); // Google was NOT attached
    expect(await prisma.account.count({ where: { providerId: "google", accountId: `sub-victim-${run}` } })).toBe(0);
  });

  it("links Google to a password account whose email IS verified (safe: same person controls the mailbox)", async () => {
    // Not reachable in the app until Phase 7 adds email verification; pinned so we notice if the
    // library's rule changes in either direction.
    const email = `verified-${run}@it.example.com`;
    const user = await prisma.user.create({ data: { email, name: "Verified", emailVerified: true } });
    await prisma.account.create({
      data: { userId: user.id, providerId: "credential", accountId: user.id, password: "scrypt$00$00" },
    });
    const res = await googleAs(email, `sub-verified-${run}`);
    expect(res.status).toBe(200);
    const accounts = await prisma.account.findMany({ where: { userId: user.id } });
    expect(accounts.map((a) => a.providerId).sort()).toEqual(["credential", "google"]);
    expect(await prisma.user.count({ where: { email } })).toBe(1); // merged, not duplicated
  });
});
