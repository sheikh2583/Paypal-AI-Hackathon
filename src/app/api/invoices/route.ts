import { isDemoRequestAuthenticated, unauthorizedResponse } from "@/lib/auth";
import { getAppEnv } from "@/lib/env";
import { listInvoiceItems } from "@/lib/invoice-list";
import { reconcilePayPalOnRead } from "@/lib/paypal/poll";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  if (!(await isDemoRequestAuthenticated())) return unauthorizedResponse();
  await reconcilePayPalOnRead();
  const items = listInvoiceItems();
  // Sandbox seed recipients can be private even when the demo itself is public.
  if (getAppEnv().demoPublic) {
    for (const { client } of items) client.email = "[redacted]";
  }
  return Response.json(items, { headers: { "Cache-Control": "no-store" } });
}
