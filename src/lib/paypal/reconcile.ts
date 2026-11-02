// reconcilePayPalInvoices: for every non-terminal local invoice with a
// paypal_invoice_id, fetch the current PayPal status, update local state,
// emit events, and write audit entries. Idempotent (D37).
import type { InvoiceStatus } from "../types";
import { db, type AppDb } from "../db/client";
import {
  insertApproval,
  listApprovals,
  listReconcilableInvoices,
  updateInvoice,
} from "../db/queries";
import { audit } from "../audit";
import { emit } from "../events";
import { getNow } from "../clock";
import { getPayPal } from "./index";

function mapPayPalStatusToLocal(paypalStatus: PayPalInvoice["status"]): InvoiceStatus | null {
  switch (paypalStatus) {
    case "PAID": return "PAID";
    case "PARTIALLY_PAID": return "PARTIALLY_PAID";
    case "CANCELLED": return "CANCELLED";
    // SENT, DRAFT, UNKNOWN — no local status change; we don't downgrade
    default: return null;
  }
}

import type { PayPalInvoice } from "../types";

export async function reconcilePayPalInvoices(database: AppDb = db): Promise<void> {
  const paypal = getPayPal();
  const invoices = listReconcilableInvoices(database);
  const now = getNow().toISOString();

  for (const invoice of invoices) {
    if (!invoice.paypalInvoiceId) continue;

    let paypalInvoice: PayPalInvoice;
    try {
      paypalInvoice = await paypal.getInvoice(invoice.paypalInvoiceId);
    } catch (err) {
      // Don't let one bad invoice break the whole run.
      audit(
        {
          actor: "paypal",
          action: "reconcile.get_invoice.error",
          invoiceId: invoice.id,
          input: { paypalInvoiceId: invoice.paypalInvoiceId },
          result: { error: err instanceof Error ? err.message : String(err) },
          ok: false,
        },
        database,
        now,
      );
      continue;
    }

    const newStatus = mapPayPalStatusToLocal(paypalInvoice.status);

    // Handle SUPERSEDED invoice that received a payment (D6).
    if (invoice.status === "SUPERSEDED" && paypalInvoice.paidCents > 0) {
      // Check for an existing UNEXPECTED_PAYMENT approval to avoid duplicates (D37).
      const existingApprovals = listApprovals(undefined, database).filter(
        (a) => a.invoiceId === invoice.id && a.kind === "UNEXPECTED_PAYMENT" && a.status === "PENDING",
      );
      if (existingApprovals.length === 0) {
        insertApproval(
          {
            invoiceId: invoice.id,
            planId: invoice.planId,
            kind: "UNEXPECTED_PAYMENT",
            reason: `Payment of ${paypalInvoice.paidCents} cents received on SUPERSEDED invoice ${invoice.paypalInvoiceId}. Manual refund or credit may be required.`,
            recommendation: "Review and decide whether to credit toward the plan or refund.",
            status: "PENDING",
            ownerResponse: null,
            createdAt: now,
            resolvedAt: null,
          },
          database,
        );
        audit(
          {
            actor: "paypal",
            action: "reconcile.unexpected_payment",
            invoiceId: invoice.id,
            input: { paypalInvoiceId: invoice.paypalInvoiceId, paidCents: paypalInvoice.paidCents },
            result: { approval: "UNEXPECTED_PAYMENT" },
            ok: true,
          },
          database,
          now,
        );
        emit({ type: "approval.created", invoiceId: invoice.id, at: now });
      }
      continue;
    }

    // Skip if no actionable status change (idempotency: D37).
    if (!newStatus || newStatus === invoice.status) continue;

    // Also skip if paid amount hasn't changed (avoid duplicate events).
    const paidChanged = paypalInvoice.paidCents !== invoice.paidCents;
    if (!paidChanged && newStatus === invoice.status) continue;

    updateInvoice(
      invoice.id,
      { status: newStatus, paidCents: paypalInvoice.paidCents },
      database,
    );

    audit(
      {
        actor: "paypal",
        action: `reconcile.invoice.${newStatus.toLowerCase()}`,
        invoiceId: invoice.id,
        input: {
          paypalInvoiceId: invoice.paypalInvoiceId,
          previousStatus: invoice.status,
          paidCents: paypalInvoice.paidCents,
        },
        result: { newStatus },
        ok: true,
      },
      database,
      now,
    );

    emit({ type: "invoice.updated", invoiceId: invoice.id, at: now });

    if (newStatus === "PAID" || newStatus === "PARTIALLY_PAID") {
      emit({ type: "invoice.paid", invoiceId: invoice.id, at: now });
    }
  }
}

