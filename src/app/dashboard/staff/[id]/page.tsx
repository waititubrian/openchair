import type { Metadata } from "next";
import Link from "next/link";
import { DetailList } from "@/components/dashboard/detail-list";
import { orNotFound } from "@/lib/not-found";
import { DAY_NAMES, formatInZone, minutesToHhmm } from "@/lib/time";
import * as availabilityService from "@/services/availability.service";
import { requireTenantContext } from "@/services/session.service";
import * as staffService from "@/services/staff.service";

export const metadata: Metadata = { title: "Staff member" };

export default async function StaffMemberPage({ params }: PageProps<"/dashboard/staff/[id]">) {
  const { id } = await params;
  const ctx = await requireTenantContext("staff:read");
  const member = await orNotFound(staffService.getStaffMember(ctx, id));
  const [hours, timeOff] = await Promise.all([
    availabilityService.getWeekly(ctx, id),
    availabilityService.listTimeOff(ctx, id),
  ]);
  const tz = ctx.tenant.timezone;
  return (
    <section className="space-y-4">
      <Link href="/dashboard/staff" className="text-sm underline underline-offset-4">
        ← All staff
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">{member.name}</h1>
      <DetailList
        items={[
          { label: "Status", value: member.active ? "Active" : "Inactive" },
          {
            label: "Weekly hours",
            value:
              hours.length === 0
                ? "Not available"
                : hours.map((h) => `${DAY_NAMES[h.dayOfWeek]} ${minutesToHhmm(h.startMinute)}–${minutesToHhmm(h.endMinute)}`).join(", "),
          },
          {
            label: "Time off",
            value:
              timeOff.length === 0
                ? "None"
                : timeOff.map((t) => `${formatInZone(t.startsAt, tz, "d MMM")} – ${formatInZone(t.endsAt, tz, "d MMM")}`).join(", "),
          },
        ]}
      />
    </section>
  );
}
