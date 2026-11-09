import type { Metadata } from "next";
import { ConfirmDeleteButton } from "@/components/dashboard/forms/confirm-delete";
import { PLATFORM_FEE_PERCENT } from "@/lib/constants/business";
import * as payoutsService from "@/services/payouts.service";
import { requireTenantContext } from "@/services/session.service";
import { openStripeDashboardAction, startOnboardingAction } from "./actions";

export const metadata: Metadata = { title: "Payouts" };

function Row({ ok, label, hint }: { ok: boolean; label: string; hint?: string }) {
  return (
    <li className="flex items-start gap-3 py-2 text-sm">
      <span aria-hidden className={ok ? "text-green-600" : "text-muted-foreground"}>
        {ok ? "✓" : "○"}
      </span>
      <span>
        <span className="font-medium">{label}</span>
        <span className="sr-only">{ok ? " (done)" : " (not done)"}</span>
        {hint && <span className="block text-muted-foreground">{hint}</span>}
      </span>
    </li>
  );
}

export default async function PayoutsPage({ searchParams }: PageProps<"/dashboard/payouts">) {
  const ctx = await requireTenantContext("payouts:manage");
  const { error } = await searchParams;
  const s = await payoutsService.getPayoutStatus(ctx);
  const ready = s.chargesEnabled && s.payoutsEnabled;

  return (
    <section className="max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Payouts</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Customers pay their booking deposit by card. The money goes to <strong>your</strong> Stripe account and Openchair keeps a{" "}
          {PLATFORM_FEE_PERCENT}% platform fee. Test mode only: no real money moves.
        </p>
      </div>

      {error && (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          We couldn&apos;t reach Stripe just now. Please try again.
        </p>
      )}
      {!s.stripeConfigured && (
        <p role="note" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          Card payments aren&apos;t configured on this server yet (no Stripe test key). Until they are, bookings are confirmed without an online deposit.
        </p>
      )}

      <div className="rounded-lg border p-4">
        <h2 className="font-medium">{ready ? "You're ready to take deposits" : s.connected ? "Finish setting up" : "Not connected yet"}</h2>
        <ul className="mt-2 divide-y">
          <Row ok={s.connected} label="Stripe account created" />
          <Row ok={s.detailsSubmitted} label="Business details submitted" />
          <Row ok={s.chargesEnabled} label="Can accept card payments" />
          <Row ok={s.payoutsEnabled} label="Can receive payouts" />
        </ul>
        {s.requirementsDue.length > 0 && (
          <p className="mt-3 text-sm text-muted-foreground">
            Stripe still needs: {s.requirementsDue.map((r) => r.replace(/[._]/g, " ")).join(", ")}.
          </p>
        )}
      </div>

      {s.stripeConfigured && (
        <div className="flex flex-wrap items-start gap-3">
          {!ready && (
            <ConfirmDeleteButton
              action={startOnboardingAction}
              label={s.connected ? "Continue setup with Stripe" : "Set up payouts with Stripe"}
              askFirst={false}
            />
          )}
          {s.detailsSubmitted && <ConfirmDeleteButton action={openStripeDashboardAction} label="Open my Stripe dashboard" askFirst={false} />}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Deposits are only collected online once your account can accept card payments. Until then, bookings are confirmed immediately and any
        deposit is settled in the shop.
      </p>
    </section>
  );
}
