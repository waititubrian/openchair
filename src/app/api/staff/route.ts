import { handle } from "@/lib/http";
import * as staffService from "@/services/staff.service";
import { requireApiTenantContext } from "@/services/session.service";

export async function GET() {
  return handle(async () => {
    const ctx = await requireApiTenantContext("staff:read");
    return Response.json(await staffService.listStaff(ctx));
  });
}
