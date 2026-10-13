# Openchair

Multi-tenant booking and deposits SaaS for barbershops and salons. **Stripe test mode only.**

> The full README (architecture diagram, data model, multi-tenancy, Stripe setup, deployment)
> is written in Phase 8. This section covers local setup so far.

## Local setup

```bash
npm install
cp .env.example .env        # defaults already point at the Docker database
npm run db:up               # Postgres 17 in Docker, host port 5434
npm run db:migrate          # applies migrations (includes the double-booking constraint)
npm run db:seed             # demo shops, staff, ~650 bookings
npm run dev
```

Demo logins (password `openchair-demo`; sign-in arrives in Phase 2):
`owner@demo.openchair.dev` (Pro shop owner), `dee@demo.openchair.dev` (staff),
`owner@sharp.openchair.dev` (Free shop), `admin@openchair.dev` (platform admin).

## Business numbers

Plan limits, Pro price, platform fee %, hold window and slot interval all live in
[src/lib/constants/business.ts](src/config/business.ts).

## Useful commands

`npm run db:reset` (wipe + migrate + seed) · `npm test` · `npm run typecheck` · `npm run lint`
