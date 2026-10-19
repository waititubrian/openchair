import type { Metadata } from "next";
import Link from "next/link";
import { DetailList } from "@/components/dashboard/detail-list";
import { ConfirmDeleteButton } from "@/components/dashboard/forms/confirm-delete";
import { ServiceForm } from "@/components/dashboard/forms/service-form";
import { centsToInput, formatMoney } from "@/lib/money";
import { orNotFound } from "@/lib/not-found";
import { can } from "@/lib/permissions";
import * as catalogService from "@/services/catalog.service";
import { requireTenantContext } from "@/services/session.service";
import * as staffService from "@/services/staff.service";
import { deleteServiceAction, updateServiceAction } from "../actions";

export const metadata: Metadata = { title: "Service" };

export default async function ServicePage({ params }: PageProps<"/dashboard/services/[id]">) {
  const { id } = await params;
  const ctx = await requireTenantContext("services:read");
  const s = await orNotFound(catalogService.getService(ctx, id));
  const staff = await staffService.listStaff(ctx);
  const canWrite = can(ctx.role, "services:write");
  const offeredBy = staff.filter((m) => s.staffIds.includes(m.id)).map((m) => m.name);

  return (
    <section className="space-y-4">
      <Link href="/dashboard/services" className="text-sm underline underline-offset-4">
        ← All services
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">{s.name}</h1>
      {canWrite ? (
        <>
          <ServiceForm
            action={updateServiceAction.bind(null, id)}
            staff={staff.filter((m) => m.active || s.staffIds.includes(m.id))}
            submitLabel="Save changes"
            initial={{
              name: s.name,
              description: s.description ?? "",
              durationMin: String(s.durationMin),
              price: centsToInput(s.priceCents),
              deposit: centsToInput(s.depositCents),
              active: s.active,
              staffIds: s.staffIds,
            }}
          />
          <div className="max-w-xl border-t pt-4">
            <h2 className="mb-2 text-sm font-medium">Delete service</h2>
            <p className="mb-3 text-sm text-muted-foreground">
              Only possible if it has never been booked. Otherwise deactivate it above.
            </p>
            <ConfirmDeleteButton action={deleteServiceAction.bind(null, id)} label="Delete service" />
          </div>
        </>
      ) : (
        <DetailList
          items={[
            { label: "Duration", value: `${s.durationMin} minutes` },
            { label: "Price", value: formatMoney(s.priceCents, ctx.tenant.currency) },
            { label: "Deposit", value: formatMoney(s.depositCents, ctx.tenant.currency) },
            { label: "Offered by", value: offeredBy.length ? offeredBy.join(", ") : "Nobody yet" },
            { label: "Status", value: s.active ? "Active" : "Inactive" },
          ]}
        />
      )}
    </section>
  );
}
