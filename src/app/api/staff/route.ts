import { handle, readJson } from "@/lib/http";
import * as staffService from "@/services/staff.service";
import { requireApiTenantContext } from "@/services/session.service";
import { createStaffInput } from "@/validators/staff";

export async function GET() {
  return handle(async () => {
    const ctx = await requireApiTenantContext("staff:read");
    return Response.json(await staffService.listStaff(ctx));
  });
}

// OWNER only. Answers 402 when the plan's staff limit is reached.
export async function POST(req: Request) {
  return handle(async () => {
    const ctx = await requireApiTenantContext("staff:write");
    const input = createStaffInput.parse(await readJson(req));
    return Response.json(await staffService.createStaffMember(ctx, input), { status: 201 });
  });
}
