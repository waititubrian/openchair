import { handle, readJson } from "@/lib/http";
import * as catalogService from "@/services/catalog.service";
import { requireApiTenantContext } from "@/services/session.service";
import { createServiceInput } from "@/validators/catalog";

export async function GET() {
  return handle(async () => {
    const ctx = await requireApiTenantContext("services:read");
    return Response.json(await catalogService.listServices(ctx));
  });
}

// OWNER only.
export async function POST(req: Request) {
  return handle(async () => {
    const ctx = await requireApiTenantContext("services:write");
    const input = createServiceInput.parse(await readJson(req));
    return Response.json(await catalogService.createService(ctx, input), { status: 201 });
  });
}
