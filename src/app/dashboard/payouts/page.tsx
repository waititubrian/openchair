import type { Metadata } from "next";
import { PayoutPhoneForm } from "@/components/payout-phone-form";
import { ConfirmDeleteButton } from "@/components/dashboard/forms/confirm-delete";
import { PLATFORM_FEE_PERCENT } from "@/lib/constants/business";
import { formatMoney } from "@/lib/money";
import { formatKenyanPhone } from "@/lib/phone";
import { formatInZone } from "@/lib/time";
import * as payoutsService from "@/services/payouts.service";
import { requireTenantContext } from "@/services/session.service";
import { clearPayoutPhoneAction, savePayoutPhoneAction } from "./actions";

export const metadata: Metadata = { title: "Payouts" };

export default async function PayoutsPage() {
  const ctx = await requireTenantContext("payouts:manage");
  const o = await payoutsService.getPayoutOverview(ctx);
  const money = (c: number) => formatMoney(c, ctx.tenant.currency);
  const tz = ctx.tenant.timezone;

  return (
    <section className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Payouts</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Customers pay their booking deposit with M-Pesa. Openchair collects it, keeps a {PLATFORM_FEE_PERCENT}% platform fee, and sends you the rest. Test mode: no real money moves.
        </p>
      </div>

      {!o.mpesaConfigured && (
        <p role="note" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          M-Pesa payments aren&apos;t set up on this server yet. Until they are, bookings confirm immediately and deposits are settled in the shop.
        </p>
      )}

      <div className="rounded-lg border p-4">
        <h2 className="font-medium">{o.depositsOnline ? "Online deposits are ON" : "Online deposits are OFF"}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {o.payoutPhone
            ? `Payouts go to ${formatKenyanPhone(o.payoutPhone)}.`
            : "Add the M-Pesa number that should receive your deposits to switch online deposits on. Until then, customers book without paying and settle the deposit in the shop."}
        </p>
        <div className="mt-3">
          <PayoutPhoneForm action={savePayoutPhoneAction} initial={o.payoutPhone ? formatKenyanPhone(o.payoutPhone) : ""} />
        </div>
        {o.payoutPhone && (
          <div className="mt-3">
            <ConfirmDeleteButton action={clearPayoutPhoneAction} label="Turn off online deposits" confirmLabel="Yes, turn off" />
          </div>
        )}
      </div>

      <div className="rounded-lg border p-4">
        <h2 className="font-medium">Your balance</h2>
        <dl className="mt-2 grid gap-1 text-sm sm:grid-cols-[14rem_1fr]">
          <dt className="text-muted-foreground">Deposits collected ({o.depositCount})</dt>
          <dd>{money(o.collectedCents)}</dd>
          <dt className="text-muted-foreground">Platform fee ({PLATFORM_FEE_PERCENT}%)</dt>
          <dd>- {money(o.feeCents)}</dd>
          <dt className="text-muted-foreground">Already paid out to you</dt>
          <dd>- {money(o.paidOutCents)}</dd>
          <dt className="font-medium">Owed to you</dt>
          <dd className="font-semibold" data-testid="balance-owed">
            {money(o.balanceCents)}
          </dd>
        </dl>
      </div>

      {o.needsRefundCount > 0 && (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {o.needsRefundCount} deposit{o.needsRefundCount === 1 ? "" : "s"} arrived for a time that was no longer available. Those customers are owed a refund; the platform will arrange it.
        </p>
      )}

      <div>
        <h2 className="mb-2 font-medium">Recent deposits</h2>
        {o.recent.length === 0 ? (
          <p className="text-sm text-muted-foreground">No deposits yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="p-3 font-medium">Paid</th>
                  <th className="p-3 font-medium">Customer</th>
                  <th className="p-3 font-medium">Service</th>
                  <th className="p-3 font-medium">Amount</th>
                  <th className="p-3 font-medium">Status</th>
                  <th className="p-3 font-medium">Receipt</th>
                </tr>
              </thead>
              <tbody>
                {o.recent.map((p) => (
                  <tr key={p.id} className="border-t">
                    <td className="p-3">{formatInZone(p.createdAt, tz, "d MMM, h:mm a")}</td>
                    <td className="p-3">{p.booking.customer.name}</td>
                    <td className="p-3">{p.booking.service.name}</td>
                    <td className="p-3">{money(p.amountCents)}</td>
                    <td className="p-3">{p.status.replace("_", " ").toLowerCase()}</td>
                    <td className="p-3 font-mono text-xs">{p.mpesaReceipt ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div>
        <h2 className="mb-2 font-medium">Payouts sent to you</h2>
        {o.payouts.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing paid out yet.</p>
        ) : (
          <ul className="divide-y rounded-lg border text-sm">
            {o.payouts.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                <span>
                  {formatInZone(p.createdAt, tz, "d MMM yyyy")} · {formatKenyanPhone(p.phone)}
                  {p.reference && <span className="ml-2 font-mono text-xs text-muted-foreground">{p.reference}</span>}
                </span>
                <span className="font-medium">{money(p.amountCents)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
