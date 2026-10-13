# Openchair

Multi-tenant booking and deposits SaaS for barbershops and salons. Shops get a public booking
link; customers book and pay a deposit without an account. **Stripe test mode only.**

**Stack:** Next.js 16, TypeScript, Tailwind, shadcn/ui, Prisma 7, Postgres, Better Auth, Zod, Stripe (planned), Resend (planned), Vitest, Playwright.

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

## Commands

| | |
|---|---|
| `npm test` | Unit tests |
| `npm run test:integration` | Integration tests (needs the database running) |
| `npm run test:e2e` | Playwright end to end (needs the seed) |
| `npm run typecheck` / `npm run lint` | Static checks |
| `npm run db:reset` | Wipe, migrate and reseed |

Plan limits, Pro price and the platform fee live in [src/lib/constants/business.ts](src/lib/constants/business.ts).

## Documentation

How the project is built, the data model, multi-tenancy, access control, decisions and the
development log are in **[Architecture.md](Architecture.md)**.

## Status and next steps

Phases 1 (database, seed) and 2 (auth, onboarding, roles, tenant isolation) are done.

1. Dashboard CRUD for services, staff, availability and time off
2. Slot generation and the public booking flow
3. Stripe Connect deposits and webhooks
4. Subscriptions and plan limits
5. Emails, analytics, platform admin
6. Final docs, landing page and deployment to Vercel and Neon

Known limitations (one shop per user, no email verification yet, and more) are listed in
[Architecture.md](Architecture.md#14-known-limitations).
