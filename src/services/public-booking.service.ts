import "server-only";
import { BOOKING, PUBLIC_BOOKING_RATE_LIMIT } from "@/lib/constants/business";
import { addDaysToDate, dateOfInstant, localInstant, todayIn } from "@/lib/dates";
import type { BookingStatus, Service, Tenant } from "@/lib/domain";
import { ConflictError, NotFoundError, RateLimitError, SlotUnavailableError, ValidationError } from "@/lib/errors";
import { generateSlots, type Slot, type StaffAvailability } from "@/lib/slots";
import { formatInZone } from "@/lib/time";
import * as availabilityRepo from "@/repositories/availability.repo";
import * as bookingRepo from "@/repositories/booking.repo";
import * as customerRepo from "@/repositories/customer.repo";
import { isOverlapViolation, isUniqueViolation } from "@/repositories/prisma-errors";
import * as rateLimitRepo from "@/repositories/rate-limit.repo";
import * as serviceRepo from "@/repositories/service.repo";
import * as staffRepo from "@/repositories/staff.repo";
import * as tenantRepo from "@/repositories/tenant.repo";
import * as timeOffRepo from "@/repositories/timeoff.repo";
import { runInTransaction } from "@/repositories/transaction";
import type { CreatePublicBookingInput } from "@/validators/booking";

// The PUBLIC booking flow: no login. Everything here starts from the shop's slug and only ever
// returns the small public shapes below (never ids of users, emails of other customers, etc.).
//
// How double booking is prevented, in layers:
//   1. A slot is only offered if the slot engine says it is free (UX).
//   2. createBooking re-computes the slots on the SERVER and refuses any start time that is not
//      one of them (never trust the browser: wrong grid, outside hours, past, time off ...).
//   3. The insert runs in a transaction; the Postgres exclusion constraint "booking_no_overlap"
//      has the final say. If two requests race for the same slot, exactly one insert wins and
//      the other gets SQLSTATE 23P01, which we turn into SlotUnavailableError.

export type PublicService = {
  id: string;
  name: string;
  description: string | null;
  durationMin: number;
  priceCents: number;
  depositCents: number;
};

/** `depositOnline`: deposits are paid by card at booking time (needs a Stripe-connected shop). */
export type PublicShop = { name: string; slug: string; timezone: string; currency: string; depositOnline: boolean };

const toPublicService = (s: Service): PublicService => ({
  id: s.id,
  name: s.name,
  description: s.description,
  durationMin: s.durationMin,
  priceCents: s.priceCents,
  depositCents: s.depositCents,
});

const toPublicShop = (t: Tenant): PublicShop => ({
  name: t.name,
  slug: t.slug,
  timezone: t.timezone,
  currency: t.currency,
  depositOnline: t.chargesEnabled,
});

async function loadTenant(slug: string): Promise<Tenant> {
  const tenant = await tenantRepo.findBySlug(slug);
  if (!tenant) throw new NotFoundError("Shop");
  return tenant;
}

/** An active service that someone can actually perform, plus the people who can. */
async function loadBookable(tenant: Tenant, serviceId: string) {
  const service = await serviceRepo.findById(tenant.id, serviceId);
  if (!service || !service.active) throw new NotFoundError("Service");
  const staff = await staffRepo.listBookableForService(tenant.id, serviceId);
  if (staff.length === 0) throw new NotFoundError("Service");
  return { service, staff };
}

// ---- reads ------------------------------------------------------------------------------------

export async function getShop(slug: string): Promise<{ shop: PublicShop; services: PublicService[] }> {
  const tenant = await loadTenant(slug);
  const services = await serviceRepo.listBookable(tenant.id);
  return { shop: toPublicShop(tenant), services: services.map(toPublicService) };
}

export async function getBookableService(slug: string, serviceId: string) {
  const tenant = await loadTenant(slug);
  const { service, staff } = await loadBookable(tenant, serviceId);
  return { shop: toPublicShop(tenant), service: toPublicService(service), staff };
}

/**
 * Slots for several consecutive calendar dates, for the given staff pool. One round of queries
 * for the whole range, then the pure engine once per date.
 */
async function computeSlots(
  tenant: Tenant,
  service: Service,
  staffIds: string[],
  dates: string[],
  now: Date,
): Promise<Map<string, Slot[]>> {
  const result = new Map<string, Slot[]>(dates.map((d) => [d, []]));
  if (dates.length === 0 || staffIds.length === 0) return result;

  const tz = tenant.timezone;
  const from = localInstant(dates[0], 0, tz);
  const to = localInstant(addDaysToDate(dates[dates.length - 1], 1), 0, tz);

  const [rules, timeOff, bookings] = await Promise.all([
    availabilityRepo.listForStaffIds(tenant.id, staffIds),
    timeOffRepo.listOverlapping(tenant.id, staffIds, from, to),
    bookingRepo.listBusy(tenant.id, staffIds, from, to, now),
  ]);

  const people: StaffAvailability[] = staffIds.map((staffId) => ({
    staffId,
    rules: rules.filter((r) => r.staffId === staffId),
    busy: [...timeOff, ...bookings]
      .filter((b) => b.staffId === staffId)
      .map((b) => ({ start: b.startsAt, end: b.endsAt })),
  }));

  for (const date of dates) {
    result.set(
      date,
      generateSlots({
        date,
        timezone: tz,
        durationMin: service.durationMin,
        intervalMin: BOOKING.slotIntervalMinutes,
        now,
        minNoticeMin: BOOKING.minNoticeMinutes,
        maxAdvanceDays: BOOKING.maxAdvanceDays,
        staff: people,
      }),
    );
  }
  return result;
}

export type DaySlots = { date: string; slots: { startsAt: string; label: string }[] };

/** One page (a week) of the time picker. */
export async function getAvailability(
  slug: string,
  serviceId: string,
  staffChoice: string,
  fromDate: string | undefined,
  now: Date = new Date(),
) {
  const tenant = await loadTenant(slug);
  const { service, staff } = await loadBookable(tenant, serviceId);

  const pool = staffChoice === "any" ? staff : staff.filter((s) => s.id === staffChoice);
  if (pool.length === 0) throw new NotFoundError("Staff member");

  const today = todayIn(tenant.timezone, now);
  const lastBookable = addDaysToDate(today, BOOKING.maxAdvanceDays);
  let from = fromDate ?? today;
  if (from < today || from > lastBookable) from = today;

  const dates = Array.from({ length: BOOKING.daysPerPage }, (_, i) => addDaysToDate(from, i));
  const slotsByDate = await computeSlots(tenant, service, pool.map((s) => s.id), dates, now);

  const prev = addDaysToDate(from, -BOOKING.daysPerPage);
  const next = addDaysToDate(from, BOOKING.daysPerPage);
  const days: DaySlots[] = dates.map((date) => ({
    date,
    slots: (slotsByDate.get(date) ?? []).map((s) => ({
      startsAt: s.startsAt.toISOString(),
      label: formatInZone(s.startsAt, tenant.timezone, "h:mm a"),
    })),
  }));

  return {
    shop: toPublicShop(tenant),
    service: toPublicService(service),
    staff,
    staffChoice,
    from,
    days,
    prevFrom: prev >= today ? prev : from > today ? today : null,
    nextFrom: next <= lastBookable ? next : null,
  };
}

// ---- create -----------------------------------------------------------------------------------

export type CreateResult = { publicToken: string; status: BookingStatus };

/**
 * Create a booking for a customer who is not logged in.
 *
 * Status: with a deposit due AND a shop that can take card payments the booking starts as
 * PENDING_PAYMENT and holds its slot for `depositHoldMinutes` (Phase 5 sends the customer to
 * Stripe). Otherwise (no deposit, or the shop hasn't connected payouts yet) it is CONFIRMED
 * straight away and any deposit is settled in the shop.
 */
export async function createBooking(
  input: CreatePublicBookingInput,
  opts: { clientKey: string; now?: Date },
): Promise<CreateResult> {
  const now = opts.now ?? new Date();
  if (input.website) throw new ValidationError("Something went wrong. Please try again."); // honeypot

  const tenant = await loadTenant(input.tenantSlug);

  const used = await rateLimitRepo.consume(`pub:${tenant.id}:${opts.clientKey}`, PUBLIC_BOOKING_RATE_LIMIT.windowSeconds, now);
  if (used > PUBLIC_BOOKING_RATE_LIMIT.max) throw new RateLimitError();

  const { service, staff } = await loadBookable(tenant, input.serviceId);
  const pool = input.staff === "any" ? staff : staff.filter((s) => s.id === input.staff);
  if (pool.length === 0) throw new NotFoundError("Staff member");

  // A double-clicked submit must not fail with "slot taken" against the customer's OWN booking
  // (their first click already took the slot), so this check comes BEFORE the slot check.
  const startsAt = new Date(input.startsAt);
  const known = await customerRepo.findByEmail(tenant.id, input.email);
  const already = known && (await bookingRepo.findLiveForCustomerAt(tenant.id, known.id, service.id, startsAt, now));
  if (already) return { publicToken: already.publicToken, status: already.status };

  // Layer 2: is this start time one of the slots the engine would offer right now?
  const date = dateOfInstant(startsAt, tenant.timezone);
  const slot = (await computeSlots(tenant, service, pool.map((s) => s.id), [date], now))
    .get(date)
    ?.find((s) => s.startsAt.getTime() === startsAt.getTime());
  if (!slot) throw new SlotUnavailableError();
  const endsAt = new Date(startsAt.getTime() + service.durationMin * 60_000);

  // "Any available": prefer the person with the lightest day so work is spread fairly.
  const dayStart = localInstant(date, 0, tenant.timezone);
  const dayEnd = localInstant(addDaysToDate(date, 1), 0, tenant.timezone);
  const load = await bookingRepo.countLiveByStaff(tenant.id, slot.staffIds, dayStart, dayEnd, now);
  const nameOf = new Map(staff.map((s) => [s.id, s.name]));
  const candidates = [...slot.staffIds].sort(
    (a, b) => (load.get(a) ?? 0) - (load.get(b) ?? 0) || (nameOf.get(a) ?? "").localeCompare(nameOf.get(b) ?? ""),
  );

  const customer = await upsertCustomer(tenant.id, { name: input.name, email: input.email, phone: input.phone });

  if ((await bookingRepo.countUpcomingLiveForCustomer(tenant.id, customer.id, now)) >= BOOKING.maxActiveBookingsPerCustomer) {
    throw new ConflictError(
      `You already have ${BOOKING.maxActiveBookingsPerCustomer} upcoming bookings with this shop. Please keep one of those or contact the shop.`,
      "TOO_MANY_BOOKINGS",
    );
  }

  const needsDeposit = service.depositCents > 0 && tenant.chargesEnabled;
  const status = needsDeposit ? ("PENDING_PAYMENT" as const) : ("CONFIRMED" as const);
  const holdExpiresAt = needsDeposit ? new Date(now.getTime() + tenant.depositHoldMinutes * 60_000) : null;

  // Layer 3: try each free person in turn, each in its OWN transaction. A failed statement
  // aborts a Postgres transaction, so a collision on person A must not poison the attempt on B.
  for (const staffId of candidates) {
    try {
      const booking = await runInTransaction(async (tx) => {
        // The constraint cannot call now(), so an expired hold would still block: free it first.
        await bookingRepo.expireStaleHolds(tenant.id, [staffId], startsAt, endsAt, now, tx);
        return bookingRepo.createLive(
          tenant.id,
          {
            serviceId: service.id,
            staffId,
            customerId: customer.id,
            startsAt,
            endsAt,
            priceCents: service.priceCents,
            depositCents: service.depositCents,
            status,
            holdExpiresAt,
          },
          tx,
        );
      });
      return { publicToken: booking.publicToken, status: booking.status };
    } catch (e) {
      if (isOverlapViolation(e)) continue; // someone else got this person at this time; try the next
      throw e;
    }
  }
  throw new SlotUnavailableError();
}

/** Two requests with the same new email can race to create the customer: the loser re-reads. */
async function upsertCustomer(tenantId: string, data: { name: string; email: string; phone?: string }) {
  try {
    return await customerRepo.upsertByEmail(tenantId, data);
  } catch (e) {
    if (isUniqueViolation(e)) return customerRepo.upsertByEmail(tenantId, data);
    throw e;
  }
}

// ---- confirmation page --------------------------------------------------------------------------

/** What the confirmation page may show: this one booking, addressed by its unguessable token. */
export async function getConfirmation(slug: string, publicToken: string) {
  const tenant = await loadTenant(slug);
  const booking = await bookingRepo.findByPublicToken(tenant.id, publicToken);
  if (!booking) throw new NotFoundError("Booking");
  return {
    shop: toPublicShop(tenant),
    booking: {
      status: booking.status,
      startsAt: booking.startsAt,
      endsAt: booking.endsAt,
      serviceName: booking.service.name,
      durationMin: booking.service.durationMin,
      staffName: booking.staff.name,
      firstName: booking.customer.name.split(" ")[0],
      priceCents: booking.priceCents,
      depositCents: booking.depositCents,
      holdExpiresAt: booking.holdExpiresAt,
    },
  };
}
