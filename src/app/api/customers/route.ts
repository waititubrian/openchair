import { handle } from "@/lib/http";
import * as customerService from "@/services/customer.service";
import { requireApiTenantContext } from "@/services/session.service";

export async function GET() {
  return handle(async () => {
    const ctx = await requireApiTenantContext("customers:read");
    return Response.json(await customerService.listCustomers(ctx));
  });
}
