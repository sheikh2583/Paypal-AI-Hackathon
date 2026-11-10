import { z } from "zod";
import { demoError, guardDemoRoute, withDemoMutation } from "@/lib/demo";
import { getPayPalEnv } from "@/lib/env";
import { reconcilePayPalInvoices } from "@/lib/paypal/reconcile";
import { simulateMockPaymentByLocalId } from "@/lib/paypal/simulate-payment";

const inputSchema = z.strictObject({
  invoiceId: z.string().min(1).max(128),
  amountCents: z.int().positive().optional(),
});

export async function POST(request: Request): Promise<Response> {
  const denied = await guardDemoRoute();
  if (denied) return denied;
  const parsed = inputSchema.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) return demoError(400, "VALIDATION_ERROR", "Provide a local invoice ID and an optional positive amount in cents.");

  return withDemoMutation("simulate-payment", async () => {
    try {
      if (getPayPalEnv().mode === "sandbox") {
        await reconcilePayPalInvoices();
        return demoError(409, "MOCK_ONLY", "Pay on the PayPal Sandbox invoice page. Simulated payments are only available in mock mode.");
      }
      return Response.json(await simulateMockPaymentByLocalId(parsed.data.invoiceId, parsed.data.amountCents));
    } catch (cause) {
      const code = (cause as { code?: string })?.code;
      if (code === "NOT_FOUND") return demoError(404, code, "Invoice was not found.");
      if (code === "NO_PAYPAL_INVOICE") return demoError(409, code, "This invoice is not linked to a PayPal invoice.");
      return demoError(500, "PAYMENT_SIMULATION_FAILED", "Could not simulate the payment.");
    }
  });
}
