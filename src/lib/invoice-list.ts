import { nextAction } from "./agent/next-action";
import { getNow } from "./clock";
import { db, type AppDb } from "./db/client";
import { getPlan, listApprovals, listInvoices } from "./db/queries";
import { computeRisk, riskLabel } from "./risk";
import { riskFeaturesForInvoice } from "./risk/service";
import type { InvoiceListItem } from "./types";

export function listInvoiceItems(database: AppDb = db, now = getNow(database), pending = listApprovals("PENDING", database)): InvoiceListItem[] {
  return listInvoices(database).map(({ invoice, client }) => {
    const approvals = pending.filter((entry) => entry.invoiceId === invoice.id);
    const plan = invoice.planId ? getPlan(invoice.planId, database) ?? null : null;
    const features = riskFeaturesForInvoice(invoice, database, now);
    const score = invoice.riskScore ?? computeRisk(features).score;
    return {
      invoice: { ...invoice, riskScore: score },
      client,
      daysOverdue: features.daysOverdue,
      riskLabel: riskLabel(score),
      nextAction: nextAction(invoice, plan, approvals, now),
      pendingApprovalId: approvals[0]?.id ?? null,
    };
  });
}
