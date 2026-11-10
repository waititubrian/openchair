# Openchair

Multi-tenant booking and deposits SaaS for barbershops and salons. Shops get a public booking
link; customers book and pay a deposit with M-Pesa without an account. Prices are in KES. **M-Pesa sandbox / simulator only.**

**Stack:** Next.js 16, TypeScript, Tailwind, shadcn/ui, Prisma 7, Postgres, Better Auth, Zod, M-Pesa (Daraja), Resend (planned), Vitest, Playwright.

## Run locally

```bash
npm install
cp .env.example .env        # then set AUTH_SECRET:  openssl rand -base64 32
npm run db:up               # Postgres in Docker on port 5434
npm run db:migrate
npm run db:seed
npm run dev                 # http://localhost:3000
```

Demo logins (password `openchair-demo`):

| Email | Role |
|---|---|
| `owner@demo.openchair.dev` | Shop owner (Pro) |
| `dee@demo.openchair.dev` | Shop staff |
| `owner@sharp.openchair.dev` | Shop owner (Free) |
| `admin@openchair.dev` | Platform admin |

## Google sign-in (optional)

1. In [Google Cloud Console](https://console.cloud.google.com/apis/credentials) create an **OAuth client ID** (type *Web application*).
2. Add the authorized redirect URI `http://localhost:3000/api/auth/callback/google` (and `https://<your-domain>/api/auth/callback/google` for production).
3. Put the client ID and secret in `.env` as `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` and restart `npm run dev`.

The "Continue with Google" button appears on the login and signup pages only when both are set.

## M-Pesa (optional: real sandbox)

Set `MPESA_MODE="simulator"` in `.env` for a built-in fake Safaricom: no keys needed. Pay with any Kenyan number to approve; `0700000001` cancels, `...002` has no funds, `...003` never answers.

For the real Daraja sandbox: set `MPESA_MODE="daraja"`, add the consumer key, secret, shortcode and passkey from the [Daraja portal](https://developer.safaricom.co.ke/), expose your dev server with a tunnel (for example ngrok) and set `MPESA_CALLBACK_BASE_URL` to it. Set `MPESA_CALLBACK_SECRET` (16+ characters) and `CRON_SECRET`. Production M-Pesa is refused.

## Commands

| | |
|---|---|
| `npm test` | Unit tests |
| `npm run test:integration` | Integration tests (needs the database running) |
| `npm run test:e2e` | Playwright end to end (needs the seed) |
| `npm run typecheck` / `npm run lint` | Static checks |
| `npm run db:reset` | Wipe, migrate and reseed |

Plan limits, Pro price (KSh 2,500) and the platform fee live in [src/lib/constants/business.ts](src/lib/constants/business.ts).

## Documentation

How the project is built, the data model, multi-tenancy, access control, decisions and the
development log are in **[Architecture.md](Architecture.md)**.

## Status and next steps

Phases 1 to 6 are done: database and seed, auth and roles, dashboard CRUD, the public booking flow (try `/b/fade-and-co` on the seeded demo), M-Pesa deposits and the Pro plan in KES.

1. Emails, analytics, platform admin
2. Final docs, landing page and deployment to Vercel and Neon

Known limitations (one shop per user, no email verification yet, and more) are listed in
[Architecture.md](Architecture.md#14-known-limitations).
