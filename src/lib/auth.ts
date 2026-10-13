import "server-only";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "@better-auth/prisma-adapter";
import { nextCookies } from "better-auth/next-js";
import { env, requireEnv } from "@/lib/env";
import { hashPassword, verifyPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";

// Better Auth owns five tables (User, Session, Account, Verification, RateLimit), so this
// is the ONE non-repository module allowed to hand the Prisma client to a library (see the
// override in eslint.config.mjs). Everything else about users goes through repositories.
//
// - Email + password always on; Google only when both credentials are configured.
// - Passwords are hashed with our scrypt helper so seeded users and signed-up users match.
// - A Google sign-in can create a user who has no shop yet: the dashboard sends such
//   users to /onboarding.
export const googleEnabled = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);

/**
 * Factory so tests can build an instance with rate limiting forced on. The app uses `auth` below.
 *
 * Rate limiting
 *  - storage "database": counters live in the RateLimit table. The default (memory) would be
 *    per serverless instance on Vercel, so an attacker would just get a fresh counter on
 *    every cold start / instance and the limit would never trigger.
 *  - Enabled by default only in production (Better Auth's own default); off in `next dev`
 *    so local work and e2e tests are not throttled.
 *  - Client IP: Vercel overwrites x-forwarded-for with the real client address and strips
 *    any client-supplied value, and also sets x-vercel-forwarded-for (which survives a
 *    third-party proxy in front of Vercel). We trust that header ONLY when running on Vercel
 *    (VERCEL env var). Anywhere else a client could send it themselves and dodge the limit,
 *    so we fall back to x-forwarded-for there.
 */
export function createAuth(opts: { rateLimitEnabled?: boolean } = {}) {
  return betterAuth({
    baseURL: env.APP_URL,
    secret: requireEnv("AUTH_SECRET"),
    database: prismaAdapter(prisma, { provider: "postgresql" }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      autoSignIn: true,
      password: {
        hash: hashPassword,
        verify: ({ hash, password }) => verifyPassword(password, hash),
      },
    },
    socialProviders: googleEnabled
      ? { google: { clientId: env.GOOGLE_CLIENT_ID!, clientSecret: env.GOOGLE_CLIENT_SECRET! } }
      : {},
    session: { expiresIn: 60 * 60 * 24 * 14, updateAge: 60 * 60 * 24 },
    rateLimit: {
      enabled: opts.rateLimitEnabled ?? process.env.NODE_ENV === "production",
      storage: "database",
      window: 10, // general limit: 100 requests / 10 s per IP and path
      max: 100,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 }, // slows password guessing: 5 tries / minute / IP
        "/sign-up/email": { window: 3600, max: 10 }, // 10 new accounts / hour / IP
      },
    },
    advanced: {
      ipAddress: {
        ipAddressHeaders: process.env.VERCEL ? ["x-vercel-forwarded-for"] : ["x-forwarded-for"],
      },
    },
    plugins: [nextCookies()], // must stay last: lets server actions set the session cookie
  });
}

export const auth = createAuth();
