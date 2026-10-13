/**
 * Seed: two demo shops with services, hours, customers and ~10 weeks of bookings,
 * so dashboards, analytics and the admin page look alive.
 *
 *   npm run db:seed        (also runs after `prisma migrate reset`)
 *
 * Re-runnable: it deletes and recreates the demo tenants and users by slug/email.
 *
 * Logins (password for all: "openchair-demo"):
 *   owner@demo.openchair.dev   OWNER of "Fade & Co"  (Pro plan)
 *   dee@demo.openchair.dev     STAFF of "Fade & Co"
 *   owner@sharp.openchair.dev  OWNER of "Sharp Cuts" (Free plan)
 *   admin@openchair.dev        PLATFORM_ADMIN
 *
 * Stripe ids written here are FAKE placeholders ("seed_..."), only so the UI has data.
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { addDays } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { PrismaClient, type BookingStatus, type Prisma } from "../src/generated/prisma/client";
import { PLATFORM_FEE_PERCENT } from "../src/lib/constants/business";
import { hashPassword } from "../src/lib/password";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

const PASSWORD = "openchair-demo";
const TZ = "America/New_York";

// Deterministic PRNG (mulberry32) so the demo data is the same on every run.
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = ["James", "Omar", "Liam", "Noah", "Elijah", "Mateo", "Kofi", "Andre", "Tyrell", "Sam", "Diego", "Ravi", "Jonah", "Leo", "Isaiah", "Caleb", "Hassan", "Victor", "Ben", "Theo"];
const LAST = ["Brooks", "Nguyen", "Okafor", "Reyes", "Patel", "Kim", "Walker", "Silva", "Hughes", "Cole", "Mensah", "Rossi"];

type ServiceSeed = { name: string; durationMin: number; priceCents: number; depositCents: number };

// Better Auth stores the password on a "credential" Account row (not on User), and
// requires that row's accountId to equal the user's id or sign-in treats the user as unknown.
async function createUser(email: string, name: string, platformRole?: "PLATFORM_ADMIN") {
  const user = await prisma.user.create({ data: { email, name, emailVerified: true, platformRole } });
  await prisma.account.create({
    data: {
      userId: user.id,
      providerId: "credential",
      accountId: user.id,
      password: await hashPassword(PASSWORD),
    },
  });
  return user;
}

async function wipe() {
  const slugs = ["fade-and-co", "sharp-cuts"];
  const tenants = await prisma.tenant.findMany({ where: { slug: { in: slugs } }, select: { id: true } });
  const ids = tenants.map((t) => t.id);
  // Children first: Booking/Payment FKs are RESTRICT, so they must go before the tenant.
  await prisma.payment.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.booking.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
  await prisma.user.deleteMany({
    where: { email: { in: ["owner@demo.openchair.dev", "dee@demo.openchair.dev", "owner@sharp.openchair.dev", "admin@openchair.dev"] } },
  });
}

async function seedBookings(opts: {
  tenantId: string;
  seed: number;
  staffIds: string[];
  services: { id: string; durationMin: number; priceCents: number; depositCents: number }[];
  customerIds: string[];
  workDays: Record<string, number[]>; // staffId -> days of week worked
  startHour: number;
  endHour: number;
  fillRate: number; // 0..1 chance a candidate slot gets a booking
  fromDay: number; // days relative to today (negative = past)
  toDay: number;
}) {
  const rand = rng(opts.seed);
  const now = new Date();
  const bookings: Prisma.BookingCreateManyInput[] = [];
  const payments: Prisma.PaymentCreateManyInput[] = [];

  for (let offset = opts.fromDay; offset <= opts.toDay; offset++) {
    const day = addDays(now, offset);
    const localDate = formatInTimeZone(day, TZ, "yyyy-MM-dd");
    const dow = Number(formatInTimeZone(day, TZ, "i")) % 7; // ISO 1..7 (Mon..Sun) -> 0=Sun

    for (const staffId of opts.staffIds) {
      if (!opts.workDays[staffId].includes(dow)) continue;
      // Walk the day in 15-minute steps; each booking pushes the cursor past itself,
      // so a staff member's bookings never overlap (the DB constraint would reject it).
      let cursor = opts.startHour * 60;
      while (cursor < opts.endHour * 60) {
        if (rand() > opts.fillRate) {
          cursor += 15;
          continue;
        }
        const svc = opts.services[Math.floor(rand() * opts.services.length)];
        if (cursor + svc.durationMin > opts.endHour * 60) break;

        const hh = String(Math.floor(cursor / 60)).padStart(2, "0");
        const mm = String(cursor % 60).padStart(2, "0");
        const startsAt = fromZonedTime(`${localDate}T${hh}:${mm}:00`, TZ); // local wall-clock -> UTC
        const endsAt = new Date(startsAt.getTime() + svc.durationMin * 60_000);
        cursor += svc.durationMin + (rand() < 0.5 ? 0 : 15);

        const past = endsAt < now;
        const r = rand();
        let status: BookingStatus;
        if (past) status = r < 0.8 ? "COMPLETED" : r < 0.9 ? "NO_SHOW" : "CANCELLED";
        else status = r < 0.92 ? "CONFIRMED" : "CANCELLED";

        const id = randomUUID();
        bookings.push({
          id,
          tenantId: opts.tenantId,
          serviceId: svc.id,
          staffId,
          customerId: opts.customerIds[Math.floor(rand() * opts.customerIds.length)],
          startsAt,
          endsAt,
          status,
          priceCents: svc.priceCents,
          depositCents: svc.depositCents,
          cancelledAt: status === "CANCELLED" ? new Date(startsAt.getTime() - 86_400_000) : null,
          cancelReason: status === "CANCELLED" ? "customer" : null,
          createdAt: new Date(startsAt.getTime() - 3 * 86_400_000),
        });
        // Every non-cancelled booking has a paid deposit.
        if (status !== "CANCELLED" && svc.depositCents > 0) {
          payments.push({
            id: randomUUID(),
            tenantId: opts.tenantId,
            bookingId: id,
            stripeCheckoutSessionId: `seed_cs_${id}`,
            stripePaymentIntentId: `seed_pi_${id}`,
            amountCents: svc.depositCents,
            applicationFeeCents: Math.floor((svc.depositCents * PLATFORM_FEE_PERCENT) / 100),
            currency: "usd",
            status: "SUCCEEDED",
            createdAt: new Date(startsAt.getTime() - 3 * 86_400_000),
          });
        }
      }
    }
  }
  await prisma.booking.createMany({ data: bookings });
  await prisma.payment.createMany({ data: payments });
  return bookings.length;
}

async function seedShop(opts: {
  slug: string;
  name: string;
  plan: "FREE" | "PRO";
  owner: { email: string; name: string };
  staff: { name: string; email?: string; days: number[]; startHour: number; endHour: number; skip?: string[] }[];
  services: ServiceSeed[];
  seed: number;
  fillRate: number;
  fromDay: number;
  toDay: number;
}) {
  const owner = await createUser(opts.owner.email, opts.owner.name);

  const tenant = await prisma.tenant.create({
    data: {
      slug: opts.slug,
      name: opts.name,
      timezone: TZ,
      plan: opts.plan,
      memberships: { create: { userId: owner.id, role: "OWNER" } },
      ...(opts.plan === "PRO" && {
        subscription: {
          create: {
            stripeSubscriptionId: `seed_sub_${opts.slug}`,
            status: "active",
            plan: "PRO",
            currentPeriodEnd: addDays(new Date(), 21),
          },
        },
      }),
    },
  });

  const services = await Promise.all(
    opts.services.map((s) => prisma.service.create({ data: { ...s, tenantId: tenant.id } })),
  );

  const staffIds: string[] = [];
  const workDays: Record<string, number[]> = {};
  for (const [i, s] of opts.staff.entries()) {
    let userId: string | undefined;
    if (s.email) {
      const u = await createUser(s.email, s.name);
      await prisma.membership.create({ data: { userId: u.id, tenantId: tenant.id, role: "STAFF" } });
      userId = u.id;
    } else if (i === 0) {
      userId = owner.id; // the owner is also the first barber
    }
    const member = await prisma.staffMember.create({ data: { tenantId: tenant.id, name: s.name, userId } });
    staffIds.push(member.id);
    workDays[member.id] = s.days;

    for (const svc of services) {
      if (s.skip?.includes(svc.name)) continue;
      await prisma.staffService.create({ data: { tenantId: tenant.id, staffId: member.id, serviceId: svc.id } });
    }
    await prisma.availabilityRule.createMany({
      data: s.days.map((d) => ({
        tenantId: tenant.id,
        staffId: member.id,
        dayOfWeek: d,
        startMinute: s.startHour * 60,
        endMinute: s.endHour * 60,
      })),
    });
  }

  // One day of time off for the last staff member, next week.
  await prisma.timeOff.create({
    data: {
      tenantId: tenant.id,
      staffId: staffIds[staffIds.length - 1],
      startsAt: addDays(new Date(), 8),
      endsAt: addDays(new Date(), 9),
      reason: "Day off",
    },
  });

  const rand = rng(opts.seed + 1);
  const customerIds: string[] = [];
  for (let i = 0; i < 24; i++) {
    const first = FIRST[Math.floor(rand() * FIRST.length)];
    const last = LAST[Math.floor(rand() * LAST.length)];
    const c = await prisma.customer.create({
      data: {
        tenantId: tenant.id,
        name: `${first} ${last}`,
        email: `${first}.${last}${i}@example.com`.toLowerCase(),
        phone: `+1555${String(1000000 + Math.floor(rand() * 8999999))}`,
      },
    });
    customerIds.push(c.id);
  }

  let total = 0;
  // Seed per staff so each member's own working hours are respected.
  for (const [i, s] of opts.staff.entries()) {
    total += await seedBookings({
      tenantId: tenant.id,
      seed: opts.seed + 10 * i,
      staffIds: [staffIds[i]],
      services: services
        .filter((svc) => !s.skip?.includes(svc.name))
        .map((svc) => ({ id: svc.id, durationMin: svc.durationMin, priceCents: svc.priceCents, depositCents: svc.depositCents })),
      customerIds,
      workDays,
      startHour: s.startHour,
      endHour: s.endHour,
      fillRate: opts.fillRate,
      fromDay: opts.fromDay,
      toDay: opts.toDay,
    });
  }
  console.log(`  ${opts.name}: ${services.length} services, ${staffIds.length} staff, ${customerIds.length} customers, ${total} bookings`);
}

async function main() {
  console.log("Seeding…");
  await wipe();

  await seedShop({
    slug: "fade-and-co",
    name: "Fade & Co",
    plan: "PRO",
    owner: { email: "owner@demo.openchair.dev", name: "Marcus Hale" },
    staff: [
      { name: "Marcus", days: [2, 3, 4, 5, 6], startHour: 9, endHour: 17 },
      { name: "Dee", email: "dee@demo.openchair.dev", days: [1, 2, 3, 4, 5], startHour: 10, endHour: 18, skip: ["Hot Towel Shave"] },
    ],
    services: [
      { name: "Classic Haircut", durationMin: 30, priceCents: 3500, depositCents: 1000 },
      { name: "Beard Trim", durationMin: 20, priceCents: 2000, depositCents: 500 },
      { name: "Cut + Beard", durationMin: 50, priceCents: 5000, depositCents: 1500 },
      { name: "Hot Towel Shave", durationMin: 30, priceCents: 3000, depositCents: 1000 },
    ],
    seed: 42,
    fillRate: 0.22,
    fromDay: -70,
    toDay: 14,
  });

  // A small Free-plan shop (1 staff), for the admin page and plan-limit demos.
  // Depending on the day you seed, it lands near or over the 30/month Free limit
  // (about 33 on 2026-10-07), which is useful for demoing the limit message.
  await seedShop({
    slug: "sharp-cuts",
    name: "Sharp Cuts",
    plan: "FREE",
    owner: { email: "owner@sharp.openchair.dev", name: "Priya Shah" },
    staff: [{ name: "Priya", days: [1, 2, 3, 4, 5, 6], startHour: 9, endHour: 16 }],
    services: [
      { name: "Haircut", durationMin: 30, priceCents: 2800, depositCents: 800 },
      { name: "Fade", durationMin: 45, priceCents: 3500, depositCents: 1000 },
    ],
    seed: 7,
    fillRate: 0.1,
    fromDay: -20,
    toDay: 10,
  });

  await createUser("admin@openchair.dev", "Platform Admin", "PLATFORM_ADMIN");

  console.log(`Done. Log in with the emails above, password: ${PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
