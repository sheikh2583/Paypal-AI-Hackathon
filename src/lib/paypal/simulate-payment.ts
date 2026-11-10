// Shared payment simulation logic reused by:
//   POST /api/mock-paypal/pay   (takes a mock PayPal invoice id)
//   POST /api/demo/simulate-payment  (takes a local invoice id, resolves PayPal id)
// Keeping logic here so both routes stay thin (D2 from DECISIONS.md).
import type { Cents } from "../types";
import { db, type AppDb } from "../db/client";
import { getInvoice } from "../db/queries";
import { getPayPalEnv } from "../env";
import { MockPayPalClient } from "./mock";
import { reconcilePayPalInvoice } from "./reconcile";

export interface SimulatePaymentResult {
  paypalInvoiceId: string;
  status: string;
}

/**
 * Simulates a payment on a MOCK PayPal invoice and then reconciles local state.
 * @param paypalInvoiceId - The mock PayPal invoice id (e.g. MOCK-INV2-XXXXXXXX).
 * @param amountCents - Optional partial payment; defaults to full amount.
 * @param database - Optional DB handle for tests.
 */
export async function simulateMockPayment(
  paypalInvoiceId: string,
  amountCents?: Cents,
  database: AppDb = db,
): Promise<SimulatePaymentResult> {
  const env = getPayPalEnv();
  if (env.mode !== "mock") {
    throw Object.assign(new Error("simulatePayment is only available in PAYPAL_MODE=mock"), {
      code: "MOCK_ONLY",
    });
  }

  const mock = new MockPayPalClient(database);
  await mock.simulatePayment(paypalInvoiceId, amountCents);
  await reconcilePayPalInvoice(paypalInvoiceId, database, mock);

  const updated = await mock.getInvoice(paypalInvoiceId);
  return { paypalInvoiceId, status: updated.status };
}

/**
 * Resolves a local invoice id to its PayPal invoice id then calls simulateMockPayment.
 * Used by POST /api/demo/simulate-payment.
 */
export async function simulateMockPaymentByLocalId(
  localInvoiceId: string,
  amountCents?: Cents,
  database: AppDb = db,
): Promise<SimulatePaymentResult> {
  const invoice = getInvoice(localInvoiceId, database);
  if (!invoice) {
    throw Object.assign(new Error(`Invoice not found: ${localInvoiceId}`), { code: "NOT_FOUND" });
  }
  if (!invoice.paypalInvoiceId) {
    throw Object.assign(
      new Error(`Invoice ${localInvoiceId} has no PayPal invoice id`),
      { code: "NO_PAYPAL_INVOICE" },
    );
  }
  return simulateMockPayment(invoice.paypalInvoiceId, amountCents, database);
}

