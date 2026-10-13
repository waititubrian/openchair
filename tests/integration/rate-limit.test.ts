import { afterAll, afterEach, describe, expect, it } from "vitest";
import { createAuth } from "@/lib/auth";
import { createTestPrisma } from "../support/db.mts";

// Exercises Better Auth's REAL rate limiter (forced on) against the real RateLimit table.
// Sign-in is limited to 5 attempts / 60 s per client IP (see src/lib/auth.ts).
const prisma = createTestPrisma();
const ORIGIN = process.env.APP_URL ?? "http://localhost:3000";
const run = Math.floor(Math.random() * 200) + 20; // spreads TEST-NET addresses so reruns don't collide
const ip = (n: number) => `203.0.113.${(run + n) % 250}`;

function signIn(auth: ReturnType<typeof createAuth>, headers: Record<string, string>) {
  return auth.handler(
    new Request(`${ORIGIN}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN, ...headers },
      body: JSON.stringify({ email: "nobody@it.example.com", password: "wrong-password" }),
    }),
  );
}
async function attempts(n: number, call: (i: number) => Promise<Response>) {
  const statuses: number[] = [];
  for (let i = 0; i < n; i++) statuses.push((await call(i)).status);
  return statuses;
}

const originalVercel = process.env.VERCEL;
afterEach(() => {
  if (originalVercel === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = originalVercel;
});
afterAll(async () => {
  await prisma.rateLimit.deleteMany({ where: { key: { contains: "203.0.113." } } });
  await prisma.$disconnect();
});

describe("rate limiting (database storage)", () => {
  it("allows 5 sign-in attempts per IP per minute, then answers 429 with Retry-After", async () => {
    const auth = createAuth({ rateLimitEnabled: true });
    const headers = { "x-forwarded-for": ip(1) };
    expect(await attempts(5, () => signIn(auth, headers))).toEqual([401, 401, 401, 401, 401]);
    const blocked = await signIn(auth, headers);
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("x-retry-after"))).toBeGreaterThan(0);
  });

  it("limits per IP: another address is not affected", async () => {
    const auth = createAuth({ rateLimitEnabled: true });
    await attempts(6, () => signIn(auth, { "x-forwarded-for": ip(2) }));
    expect((await signIn(auth, { "x-forwarded-for": ip(3) })).status).toBe(401);
  });

  it("counters live in Postgres, so a second 'serverless instance' sees them (memory would not)", async () => {
    const first = createAuth({ rateLimitEnabled: true });
    const headers = { "x-forwarded-for": ip(4) };
    await attempts(5, () => signIn(first, headers));

    const rows = await prisma.rateLimit.findMany({ where: { key: { contains: ip(4) } } });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => r.key.includes("sign-in") && r.count >= 5)).toBe(true);

    const freshInstanceWithEmptyMemory = createAuth({ rateLimitEnabled: true });
    expect((await signIn(freshInstanceWithEmptyMemory, headers)).status).toBe(429);
  });

  it("OFF Vercel: a client-supplied x-vercel-forwarded-for is ignored (cannot be used to dodge the limit)", async () => {
    delete process.env.VERCEL;
    const auth = createAuth({ rateLimitEnabled: true });
    const statuses = await attempts(7, (i) =>
      signIn(auth, { "x-forwarded-for": ip(5), "x-vercel-forwarded-for": `198.51.100.${i + 1}` }),
    );
    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(statuses.slice(5)).toEqual([429, 429]);
  });

  it("ON Vercel: the limit follows x-vercel-forwarded-for even if x-forwarded-for varies", async () => {
    process.env.VERCEL = "1";
    const auth = createAuth({ rateLimitEnabled: true });
    const statuses = await attempts(7, (i) =>
      signIn(auth, { "x-vercel-forwarded-for": ip(6), "x-forwarded-for": `198.51.100.${i + 10}` }),
    );
    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(statuses.slice(5)).toEqual([429, 429]);
  });

  it("is off by default outside production (so local dev and e2e are not throttled)", async () => {
    const auth = createAuth(); // NODE_ENV is "test" here
    const statuses = await attempts(8, () => signIn(auth, { "x-forwarded-for": ip(7) }));
    expect(statuses.every((s) => s === 401)).toBe(true);
  });
});
