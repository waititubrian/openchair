import type { Metadata } from "next";
import { AutoRefresh } from "@/components/auto-refresh";
import { MpesaPhoneForm } from "@/components/mpesa-phone-form";
import { PLANS } from "@/lib/constants/business";
import { formatMoney } from "@/lib/money";
import { failureMessage } from "@/lib/mpesa-results";
import { formatInZone } from "@/lib/time";
import * as billingService from "@/services/billing.service";
import * as mpesaSettlement from "@/services/mpesa-settlement.service";
import * as planService from "@/services/plan.service";
import { requireTenantContext } from "@/services/session.service";
import { payForProAction } from "./actions";

export const metadata: Metadata = { title: "Billing" };

const STATUS_STYLE: Record<string, string> = {
  SUCCEEDED: "text-green-700 dark:text-green-400",
  PENDING: "text-amber-700 dark:text-amber-400",
  FAILED: "text-red-700 dark:text-red-400",
};

export default async function BillingPage() {
  const ctx = await requireTenantContext("billing:manage");

  // If a prompt is outstanding, ask Safaricom for its result now (the callback may be a moment behind).
  let summary = await billingService.getBillingSummary(ctx);
  if (summary.waitingForPrompt) {
    try {
      await mpesaSettlement.reconcileSubscriptionPayment(ctx.tenantId);
    } catch (e) {
      console.error("subscription status check failed", e);
    }
    summary = await billingService.getBillingSummary(ctx);
  }
  const usage = await planService.getBookingUsage(ctx);
  const tz = ctx.tenant.timezone;
  const day = (d: Date) => formatInZone(d, tz, "EEE d MMM yyyy");
  const { state } = summary;
  const isPro = state.state === "active" || state.state === "grace";
  const price = formatMoney(summary.priceCents, ctx.tenant.currency);

  return (
    <section className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Billing</h1>
        <p className="mt-1 text-sm text-muted-foreground">Pay for Pro with M-Pesa. Test mode: no real money moves.</p>
      </div>

      <div className="rounded-lg border p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-medium">{summary.planLabel} plan</h2>
          {state.state === "active" && <span className="text-sm text-green-700 dark:text-green-400">Active</span>}
          {state.state === "grace" && <span className="text-sm text-amber-700 dark:text-amber-400">Renew now</span>}
        </div>

        {state.state === "free" && <p className="mt-1 text-sm text-muted-foreground">1 staff member and {PLANS.FREE.maxBookingsPerMonth} bookings a month.</p>}
        {state.state === "active" && (
          <p className="mt-1 text-sm text-muted-foreground">
            Paid until <strong>{day(state.periodEnd)}</strong> ({state.daysLeft} day{state.daysLeft === 1 ? "" : "s"} left). Unlimited staff and bookings.
          </p>
        )}
        {state.state === "grace" && (
          <p role="note" className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
            Your paid period ended on {day(state.periodEnd)}. Pro keeps working until <strong>{day(state.graceEnds)}</strong>, then your shop moves to Free (your data is kept; extra staff are switched off). Renew to stay on Pro.
          </p>
        )}
        {state.state === "expired" && (
          <p className="mt-1 text-sm text-muted-foreground">Your Pro period ended on {day(state.periodEnd)}. Your shop is on Free until you renew.</p>
        )}

        {usage.limit !== null && (
          <div className="mt-4">
            <p className="text-sm">
              <strong>{usage.used}</strong> of {usage.limit} bookings used this month
            </p>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={usage.limit} aria-valuenow={Math.min(usage.used, usage.limit)}>
              <div className={`h-full ${usage.used >= usage.limit ? "bg-red-500" : "bg-foreground"}`} style={{ width: `${Math.min(100, (usage.used / usage.limit) * 100)}%` }} />
            </div>
            {usage.used >= usage.limit && <p className="mt-1 text-sm text-red-700 dark:text-red-300">Limit reached: customers can&apos;t book online until next month, or until you upgrade.</p>}
          </div>
        )}
      </div>

      {summary.waitingForPrompt ? (
        <div className="rounded-lg border p-4" aria-live="polite">
          <h2 className="font-medium">Check your phone</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            We sent an M-Pesa prompt for {price} to {summary.waitingForPrompt.maskedPhone}. Enter your M-Pesa PIN to confirm. This page updates by itself.
          </p>
          <AutoRefresh seconds={90} everyMs={3000} />
        </div>
      ) : summary.mpesaConfigured ? (
        <div className="rounded-lg border p-4">
          <h2 className="font-medium">{isPro ? `Renew Pro for ${summary.periodDays} more days` : `Upgrade to Pro: ${price} for ${summary.periodDays} days`}</h2>
          {isPro && <p className="mt-1 text-sm text-muted-foreground">Renewing adds {summary.periodDays} days to your current end date, so paying early loses nothing.</p>}
          {summary.payments[0]?.status === "FAILED" && (
            <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">
              Your last payment didn&apos;t go through: {failureMessage(summary.payments[0].failureReason)}
            </p>
          )}
          <div className="mt-3 max-w-sm">
            <MpesaPhoneForm action={payForProAction} submitLabel={`Pay ${price} with M-Pesa`} hint="Pro is prepaid. M-Pesa can't charge you automatically, so renew when it's due." />
          </div>
        </div>
      ) : (
        <p role="note" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          M-Pesa payments aren&apos;t set up on this server yet (no Daraja credentials).
        </p>
      )}

      <div>
        <h2 className="mb-2 font-medium">Payment history</h2>
        {summary.payments.length === 0 ? (
          <p className="text-sm text-muted-foreground">No payments yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="p-3 font-medium">Date</th>
                  <th className="p-3 font-medium">Amount</th>
                  <th className="p-3 font-medium">Status</th>
                  <th className="p-3 font-medium">M-Pesa receipt</th>
                  <th className="p-3 font-medium">Pro until</th>
                </tr>
              </thead>
              <tbody>
                {summary.payments.map((p) => (
                  <tr key={p.id} className="border-t">
                    <td className="p-3">{day(p.createdAt)}</td>
                    <td className="p-3">{formatMoney(p.amountCents, ctx.tenant.currency)}</td>
                    <td className={`p-3 ${STATUS_STYLE[p.status] ?? ""}`}>{p.status.toLowerCase()}</td>
                    <td className="p-3 font-mono text-xs">{p.receipt ?? "-"}</td>
                    <td className="p-3">{p.periodEnd ? day(p.periodEnd) : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
