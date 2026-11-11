// Serialisable rows for the dashboard grid, built on the server from InvoiceListItem.
import { chaseStateLabels, initials } from "./labels";
import type { InvoiceListItem } from "./types";

export interface InvoiceGridRow {
  id: string;
  clientName: string;
  initials: string;
  number: string;
  description: string;
  /** Null when the original invoice was replaced by an installment plan. */
  amountDueCents: number | null;
  amountDetail: string;
  dueAt: string;
  daysOverdue: number;
  riskScore: number;
  riskLabel: InvoiceListItem["riskLabel"];
  stage: string;
  nextAction: string;
  needsOwner: boolean;
  resolved: boolean;
}

export function toInvoiceGridRow({ invoice, client, daysOverdue, riskLabel, nextAction, pendingApprovalId }: InvoiceListItem): InvoiceGridRow {
  const planPaid = invoice.status === "SUPERSEDED" && invoice.chaseState === "RESOLVED";
  const superseded = invoice.status === "SUPERSEDED";
  const due = new Date(invoice.dueAt).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return {
    id: invoice.id,
    clientName: client.name,
    initials: initials(client.name),
    number: invoice.number,
    description: invoice.description,
    amountDueCents: planPaid ? 0 : superseded ? null : Math.max(0, invoice.amountCents - invoice.paidCents),
    amountDetail: planPaid ? "Plan paid in full" : superseded ? "Replaced by installments" : `Due ${due}`,
    dueAt: invoice.dueAt,
    daysOverdue: planPaid || superseded ? 0 : daysOverdue,
    riskScore: invoice.riskScore ?? 0,
    riskLabel,
    stage: chaseStateLabels[invoice.chaseState],
    nextAction,
    needsOwner: pendingApprovalId !== null || invoice.chaseState === "ESCALATED",
    resolved: planPaid,
  };
}
