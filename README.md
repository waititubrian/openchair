# Openchair

Multi-tenant booking and deposits SaaS for barbershops and salons. **Stripe test mode only.**

> The full README (architecture diagram, data model, Stripe setup, deployment) is written in
> Phase 8. This section covers what exists so far.

## Local setup

```bash
npm install
cp .env.example .env        # then set AUTH_SECRET:  openssl rand -base64 32
npm run db:up               # Postgres 17 in Docker, host port 5434
npm run db:migrate          # applies migrations (includes the double-booking constraint)
npm run db:seed             # demo shops, staff, ~650 bookings
npm run dev
```

Demo logins (password `openchair-demo`):

| Email | Role |
|---|---|
| `owner@demo.openchair.dev` | OWNER of "Fade & Co" (Pro plan) |
| `dee@demo.openchair.dev` | STAFF of "Fade & Co" (no billing/payouts/settings) |
| `owner@sharp.openchair.dev` | OWNER of "Sharp Cuts" (Free plan) |
| `admin@openchair.dev` | PLATFORM_ADMIN (`/admin`, no shop) |

## Architecture (layers)

```
src/app           pages, route handlers, server actions: THIN (validate -> service -> result)
src/validators    Zod schemas by feature
src/services      all business logic; never imports Prisma
src/repositories  the ONLY place Prisma is used; every function takes tenantId
src/lib           shared, no UI: clients (prisma, auth), env, money/time, errors, constants
```

`eslint.config.mjs` enforces the boundaries (`no-restricted-imports`): Prisma only in
repositories, repositories never imported from `app`/`components`, `lib` never imports services.

## Auth and access control

- **Better Auth** (email + password, Google when `GOOGLE_CLIENT_ID/SECRET` are set), sessions in Postgres.
  Mounted at `/api/auth/*`; sign-in/up go through server actions validated with Zod.
- `src/proxy.ts` only does an **optimistic** cookie check to redirect signed-out visitors.
  The real check is `requireTenantContext()` in [session.service.ts](src/services/session.service.ts),
  called first by every dashboard page and action. It is also the only source of `tenantId`.
- Roles: tenant `OWNER` / `STAFF` via `Membership`; `PLATFORM_ADMIN` is a separate flag on `User`.
  Permissions live in [src/lib/permissions.ts](src/lib/permissions.ts). Staff can read/write all
  bookings but have no billing, payouts or settings access (a per-staff visibility setting is a
  possible future option).
- Staff schedules: an OWNER manages every staff member's availability and time off; a STAFF user
  manages only their own (`StaffMember.userId` must match the acting user). Enforced in
  [availability.service.ts](src/services/availability.service.ts), so it holds for pages, actions and
  API routes alike. Cross-shop ids are a 404; a colleague's id inside your own shop is a 403.
- `Membership` is its own table (user, tenant, role, unique per pair), so one user can belong to
  several shops. The app currently uses a user's oldest membership (see limitations below).
- Rate limiting is covered under *Known limitations and next steps*.

## Business numbers

Plan limits, Pro price, platform fee %, hold window and slot interval live in
[src/lib/constants/business.ts](src/lib/constants/business.ts).

## Tests and checks

```bash
npm test                  # unit (validators, permissions, money/time, password)
npm run test:integration  # real Postgres: onboarding atomicity, tenant isolation, role rules, rate limiting
npm run test:e2e          # Playwright over HTTP: onboarding, login, roles, two-shop tenant isolation (starts the dev server; needs seed)
npm run typecheck && npm run lint
```

`npm run db:reset` wipes, migrates and reseeds (also clears leftover e2e users).

## Known limitations and next steps

- **One shop per user.** The data model supports many (`Membership` is separate), and onboarding
  deliberately creates exactly one. There is no shop switcher yet; the app uses the user's oldest
  membership. A switcher and "create another shop" flow are future work.
- **No email verification or password reset yet.** Both arrive in Phase 7 with Resend. Until then
  accounts are usable immediately after sign-up, and a forgotten password cannot be recovered.
- **Rate limiting** (Better Auth, configured in [src/lib/auth.ts](src/lib/auth.ts)):
  - Counters are stored in Postgres (`RateLimit` table), not memory. On Vercel each serverless
    instance has its own memory, so in-memory counters would never add up and an attacker would
    effectively be unlimited.
  - Limits: sign-in 5 attempts per minute per IP, sign-up 10 per hour per IP, everything else
    100 requests per 10 seconds per IP and path. Over the limit the API answers `429` with an
    `X-Retry-After` header.
  - Enabled by default only when `NODE_ENV=production`, so local development and Playwright
    are not throttled. Tests force it on to verify it.
  - Client IP: on Vercel the limiter reads `x-vercel-forwarded-for` (set by Vercel; it survives a
    proxy placed in front of Vercel). Anywhere else it reads `x-forwarded-for`, because a client
    could otherwise send `x-vercel-forwarded-for` itself and dodge the limit. If you self-host,
    make sure your reverse proxy overwrites `x-forwarded-for`.
  - Limits are per IP, so many users behind one office or mobile-carrier NAT share a budget.
  - Each limited request costs a small database read/write; acceptable at this scale.
- **Staff visibility:** STAFF see and edit all bookings in their shop. A per-staff "only my own
  bookings" setting is a possible future option.
- **Dashboard CRUD forms** for services, staff, availability and time off are Phase 3. The API
  routes and services behind them (including the ownership rules above) already exist and are tested.
- The signed-in dashboard is rendered per request on purpose (the session and role are read fresh,
  never cached in the browser). Next.js dev-time "instant navigation" checks are therefore opt-in
  (`validationLevel: "manual-warning"`); the public booking pages will opt in.
