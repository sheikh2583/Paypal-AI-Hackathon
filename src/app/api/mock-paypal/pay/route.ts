// POST /api/mock-paypal/pay
// Mock mode only. Validates input, calls simulateMockPayment(), returns result.
// In real mode returns 409 with contract error shape.
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getPayPalEnv } from "@/lib/env";
import { simulateMockPayment } from "@/lib/paypal/simulate-payment";
import { isDemoRequestAuthenticated, unauthorizedResponse } from "@/lib/auth";

const bodySchema = z.object({
  paypalInvoiceId: z.string().min(1),
  amountCents: z.int().positive().optional(),
});

export async function POST(req: NextRequest): Promise<Response> {
  if (!isDemoRequestAuthenticated(req)) return unauthorizedResponse();
  // Guard: mock mode only.
  const env = getPayPalEnv();
  if (env.mode !== "mock") {
    return NextResponse.json(
      { error: { code: "MOCK_ONLY", message: "This endpoint is only available in PAYPAL_MODE=mock." } },
      { status: 409 },
    );
  }

  // Validate body.
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "Request body must be valid JSON." } },
      { status: 400 },
    );
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues.map((i) => i.message).join("; ");
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message } },
      { status: 400 },
    );
  }

  const { paypalInvoiceId, amountCents } = parsed.data;

  try {
    const result = await simulateMockPayment(paypalInvoiceId, amountCents);
    return NextResponse.json(result);
  } catch (err) {
    const code = (err as { code?: string }).code;
    const message = err instanceof Error ? err.message : "Unexpected error";
    if (code === "NOT_FOUND") {
      return NextResponse.json({ error: { code: "NOT_FOUND", message } }, { status: 404 });
    }
    return NextResponse.json({ error: { code: "INTERNAL_ERROR", message } }, { status: 500 });
  }
}

