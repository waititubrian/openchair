import { handle, readJson } from "@/lib/http";
import * as availabilityService from "@/services/availability.service";
import { requireApiTenantContext } from "@/services/session.service";
import { weeklyRulesInput } from "@/validators/availability";

export async function GET(_req: Request, route: RouteContext<"/api/staff/[id]/availability">) {
  return handle(async () => {
    const { id } = await route.params;
    const ctx = await requireApiTenantContext("staff:read");
    return Response.json(await availabilityService.getWeekly(ctx, id));
  });
}

// OWNER: any staff member. STAFF: only their own (enforced in availabilityService).
export async function PUT(req: Request, route: RouteContext<"/api/staff/[id]/availability">) {
  return handle(async () => {
    const { id } = await route.params;
    const ctx = await requireApiTenantContext("availability:write");
    const rules = weeklyRulesInput.parse(await readJson(req));
    return Response.json(await availabilityService.replaceWeekly(ctx, id, rules));
  });
}
