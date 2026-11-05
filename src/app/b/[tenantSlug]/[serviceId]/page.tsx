import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { detailsPath, servicePath } from "@/lib/booking-links";
import { formatDateLabel } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { orNotFound } from "@/lib/not-found";
import { cn } from "@/lib/utils";
import * as publicBooking from "@/services/public-booking.service";
import { slotPickerQuery } from "@/validators/booking";

export const metadata: Metadata = { title: "Choose a time" };

export default function ServicePage({ params, searchParams }: PageProps<"/b/[tenantSlug]/[serviceId]">) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-lg bg-muted" aria-busy="true" aria-label="Loading times" />}>
      <Picker params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Picker({ params, searchParams }: Pick<PageProps<"/b/[tenantSlug]/[serviceId]">, "params" | "searchParams">) {
  const { tenantSlug, serviceId } = await params;
  const raw = await searchParams;
  const q = slotPickerQuery.parse({
    staff: Array.isArray(raw.staff) ? raw.staff[0] : raw.staff,
    from: Array.isArray(raw.from) ? raw.from[0] : raw.from,
    date: Array.isArray(raw.date) ? raw.date[0] : raw.date,
  });

  const a = await orNotFound(publicBooking.getAvailability(tenantSlug, serviceId, q.staff, q.from));
  // Selected day: the one in the URL if it is on this page, else the first day that has times.
  const selected =
    a.days.find((d) => d.date === q.date) ?? a.days.find((d) => d.slots.length > 0) ?? a.days[0];
  const href = (over: { staff?: string; from?: string; date?: string }) =>
    servicePath(a.shop.slug, a.service.id, { staff: a.staffChoice, from: a.from, ...over });

  return (
    <section className="space-y-6">
      <div>
        <Link href={`/b/${a.shop.slug}`} className="text-sm underline underline-offset-4">
          ← {a.shop.name}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{a.service.name}</h1>
        <p className="text-sm text-muted-foreground">
          {a.service.durationMin} minutes · {formatMoney(a.service.priceCents, a.shop.currency)}
        </p>
      </div>

      {a.staff.length > 1 && (
        <nav aria-label="Choose who" className="flex flex-wrap gap-2">
          {[{ id: "any", name: "Anyone available" }, ...a.staff].map((s) => (
            <Link
              key={s.id}
              href={servicePath(a.shop.slug, a.service.id, { staff: s.id })}
              aria-current={a.staffChoice === s.id ? "true" : undefined}
              className={cn(
                "rounded-full border px-3 py-1.5 text-sm",
                a.staffChoice === s.id ? "border-foreground bg-foreground text-background" : "hover:bg-muted",
              )}
            >
              {s.name}
            </Link>
          ))}
        </nav>
      )}

      <div className="flex items-center justify-between gap-2">
        {a.prevFrom ? (
          <Link href={href({ from: a.prevFrom, date: undefined })} className="text-sm underline underline-offset-4">
            ← Earlier
          </Link>
        ) : (
          <span />
        )}
        {a.nextFrom ? (
          <Link href={href({ from: a.nextFrom, date: undefined })} className="text-sm underline underline-offset-4">
            Later →
          </Link>
        ) : (
          <span />
        )}
      </div>

      <nav aria-label="Choose a day" className="grid grid-cols-7 gap-1.5">
        {a.days.map((d) => {
          const isSelected = d.date === selected.date;
          const [dow, ...rest] = formatDateLabel(d.date).split(", ");
          const inner = (
            <>
              <span className="block text-xs text-muted-foreground">{dow}</span>
              <span className="block text-sm font-medium">{rest.join(" ")}</span>
            </>
          );
          return d.slots.length === 0 ? (
            <span key={d.date} aria-disabled="true" className="rounded-md border border-dashed px-1 py-2 text-center opacity-40">
              {inner}
            </span>
          ) : (
            <Link
              key={d.date}
              href={href({ date: d.date })}
              aria-current={isSelected ? "date" : undefined}
              className={cn(
                "rounded-md border px-1 py-2 text-center",
                isSelected ? "border-foreground bg-foreground text-background [&_span]:text-background" : "hover:bg-muted",
              )}
            >
              {inner}
            </Link>
          );
        })}
      </nav>

      <div aria-live="polite">
        {a.days.every((d) => d.slots.length === 0) ? (
          <div className="rounded-lg border border-dashed p-8 text-center">
            <p className="font-medium">No times available this week</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {a.nextFrom ? "Try the next week, or choose someone else." : "Please check back later or contact the shop."}
            </p>
          </div>
        ) : (
          <>
            <h2 className="mb-3 text-sm font-medium">{formatDateLabel(selected.date)}</h2>
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {selected.slots.map((s) => (
                <li key={s.startsAt}>
                  <Link
                    href={detailsPath(a.shop.slug, a.service.id, a.staffChoice, s.startsAt)}
                    className="block rounded-md border px-2 py-2.5 text-center text-sm hover:border-foreground hover:bg-muted"
                  >
                    {s.label}
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      <p className="text-xs text-muted-foreground">Times are shown in {a.shop.timezone}.</p>
    </section>
  );
}
