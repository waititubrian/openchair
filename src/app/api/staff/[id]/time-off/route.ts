import { handle, readJson } from "@/lib/http";
import * as availabilityService from "@/services/availability.service";
import { requireApiTenantContext } from "@/services/session.service";
import { timeOffInput } from "@/validators/availability";

export async function GET(_req: Request, route: RouteContext<"/api/staff/[id]/time-off">) {
  return handle(async () => {
    const { id } = await route.params;
    const ctx = await requireApiTenantContext("staff:read");
    return Response.json(await availabilityService.listTimeOff(ctx, id));
  });
}

export async function POST(req: Request, route: RouteContext<"/api/staff/[id]/time-off">) {
  return handle(async () => {
    const { id } = await route.params;
    const ctx = await requireApiTenantContext("availability:write");
    const input = timeOffInput.parse(await readJson(req));
    return Response.json(await availabilityService.addTimeOff(ctx, id, input), { status: 201 });
  });
}
