import type { Metadata } from "next";
import Link from "next/link";
import { ServiceForm } from "@/components/dashboard/forms/service-form";
import * as staffService from "@/services/staff.service";
import { requireTenantContext } from "@/services/session.service";
import { createServiceAction } from "../actions";

export const metadata: Metadata = { title: "New service" };

export default async function NewServicePage() {
  const ctx = await requireTenantContext("services:write");
  const staff = (await staffService.listStaff(ctx)).filter((s) => s.active);
  return (
    <section className="space-y-4">
      <Link href="/dashboard/services" className="text-sm underline underline-offset-4">
        ← All services
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">New service</h1>
      <ServiceForm action={createServiceAction} staff={staff} submitLabel="Create service" />
    </section>
  );
}
