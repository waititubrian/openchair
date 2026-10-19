import type { Metadata } from "next";
import Link from "next/link";
import { StaffForm } from "@/components/dashboard/forms/staff-form";
import * as catalogService from "@/services/catalog.service";
import { requireTenantContext } from "@/services/session.service";
import { createStaffAction } from "../actions";

export const metadata: Metadata = { title: "Add staff member" };

export default async function NewStaffPage() {
  const ctx = await requireTenantContext("staff:write");
  const services = (await catalogService.listServices(ctx)).filter((s) => s.active);
  return (
    <section className="space-y-4">
      <Link href="/dashboard/staff" className="text-sm underline underline-offset-4">
        ← All staff
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">Add staff member</h1>
      <p className="max-w-xl text-sm text-muted-foreground">
        A staff member is someone customers can book. Set their hours on their page after adding them.
      </p>
      <StaffForm action={createStaffAction} services={services} submitLabel="Add staff member" showActive={false} />
    </section>
  );
}
