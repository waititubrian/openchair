import type { Metadata } from "next";
import Link from "next/link";
import { DetailList } from "@/components/dashboard/detail-list";
import { ConfirmDeleteButton } from "@/components/dashboard/forms/confirm-delete";
import { HoursEditor } from "@/components/dashboard/forms/hours-editor";
import { StaffForm } from "@/components/dashboard/forms/staff-form";
import { TimeOffForm } from "@/components/dashboard/forms/time-off-form";
import { orNotFound } from "@/lib/not-found";
import { can, canManageSchedule } from "@/lib/permissions";
import { DAY_NAMES, formatInZone, minutesToHhmm } from "@/lib/time";
import * as availabilityService from "@/services/availability.service";
import * as catalogService from "@/services/catalog.service";
import { requireTenantContext } from "@/services/session.service";
import * as staffService from "@/services/staff.service";
import { addTimeOffAction, deleteStaffAction, removeTimeOffAction, saveHoursAction, updateStaffAction } from "../actions";

export const metadata: Metadata = { title: "Staff member" };

export default async function StaffMemberPage({ params }: PageProps<"/dashboard/staff/[id]">) {
  const { id } = await params;
  const ctx = await requireTenantContext("staff:read");
  const member = await orNotFound(staffService.getStaffMember(ctx, id));
  const [hours, timeOff, services] = await Promise.all([
    availabilityService.getWeekly(ctx, id),
    availabilityService.listTimeOff(ctx, id),
    catalogService.listServices(ctx),
  ]);
  const tz = ctx.tenant.timezone;
  const canEditProfile = can(ctx.role, "staff:write");
  const canEditSchedule = canManageSchedule({ role: ctx.role, userId: ctx.user.id }, member);
  const now = new Date();
  const upcoming = timeOff.filter((t) => t.endsAt >= now);
  const performs = services.filter((s) => member.serviceIds.includes(s.id)).map((s) => s.name);

  return (
    <section className="space-y-8">
      <div className="space-y-2">
        <Link href="/dashboard/staff" className="text-sm underline underline-offset-4">
          ← All staff
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">{member.name}</h1>
        {ctx.user.id === member.userId && <p className="text-sm text-muted-foreground">This is you.</p>}
      </div>

      <div className="space-y-3">
        <h2 className="text-lg font-medium">Profile</h2>
        {canEditProfile ? (
          <>
            <StaffForm
              action={updateStaffAction.bind(null, id)}
              services={services.filter((s) => s.active || member.serviceIds.includes(s.id))}
              submitLabel="Save changes"
              initial={{ name: member.name, active: member.active, serviceIds: member.serviceIds }}
            />
            <div className="max-w-xl border-t pt-4">
              <p className="mb-3 text-sm text-muted-foreground">
                Delete is only possible if this person has never had a booking. Otherwise deactivate them above.
              </p>
              <ConfirmDeleteButton action={deleteStaffAction.bind(null, id)} label="Delete staff member" />
            </div>
          </>
        ) : (
          <DetailList
            items={[
              { label: "Status", value: member.active ? "Active" : "Inactive" },
              { label: "Services", value: performs.length ? performs.join(", ") : "None yet" },
            ]}
          />
        )}
      </div>

      <div id="hours" className="space-y-3">
        <h2 className="text-lg font-medium">Weekly hours</h2>
        {canEditSchedule ? (
          <HoursEditor action={saveHoursAction.bind(null, id)} initial={hours} />
        ) : (
          <>
            <p className="text-sm text-muted-foreground">Only the owner or {member.name} can change these hours.</p>
            <DetailList
              items={
                hours.length === 0
                  ? [{ label: "Hours", value: "Not available" }]
                  : hours.map((h, i) => ({
                      label: i === 0 || hours[i - 1].dayOfWeek !== h.dayOfWeek ? DAY_NAMES[h.dayOfWeek] : "",
                      value: `${minutesToHhmm(h.startMinute)}–${minutesToHhmm(h.endMinute)}`,
                    }))
              }
            />
          </>
        )}
      </div>

      <div id="time-off" className="space-y-3">
        <h2 className="text-lg font-medium">Time off</h2>
        {upcoming.length === 0 ? (
          <p className="text-sm text-muted-foreground">No upcoming time off.</p>
        ) : (
          <ul className="max-w-xl divide-y rounded-lg border">
            {upcoming.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                <span>
                  {formatInZone(t.startsAt, tz, "EEE d MMM, h:mm a")} → {formatInZone(t.endsAt, tz, "EEE d MMM, h:mm a")}
                  {t.reason && <span className="text-muted-foreground"> · {t.reason}</span>}
                </span>
                {canEditSchedule && (
                  <ConfirmDeleteButton action={removeTimeOffAction.bind(null, t.id)} label="Remove" askFirst={false} />
                )}
              </li>
            ))}
          </ul>
        )}
        {canEditSchedule && <TimeOffForm action={addTimeOffAction.bind(null, id)} timezone={tz} />}
      </div>
    </section>
  );
}
