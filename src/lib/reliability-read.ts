import { and, eq, isNotNull, sql } from "drizzle-orm";
import { getDemoSession } from "./auth";
import { getNow } from "./clock";
import { db } from "./db/client";
import { approvals, auditLog, clients, invoices } from "./db/schema";
import { getAppEnv } from "./env";
import { computeReliability } from "./reliability";
import type { ReliabilityEvent } from "./types";

// The anonymous view is limited to the documented fixture roots and their installments.
const DEMO_ROOTS = new Map([
  ["invoice-dana-900", "client-dana"],
  ["invoice-history-dana", "client-dana"],
  ["invoice-marcus-1250", "client-marcus"],
  ["invoice-history-marcus", "client-marcus"],
  ["invoice-priya-600", "client-priya"],
  ["invoice-tom-350", "client-tom"],
  ["invoice-elena-2400", "client-elena"],
]);
const DEMO_CLIENTS = new Set(DEMO_ROOTS.values());

export async function loadClientReliability() {
  if (!(await getDemoSession())) return null;
  const { demoPublic } = getAppEnv();
  const visibleClients = db.select({ id: clients.id, name: clients.name }).from(clients).all()
    .filter(({ id }) => !demoPublic || DEMO_CLIENTS.has(id));
  const invoiceRows = db.select({
    id: invoices.id, clientId: invoices.clientId, dueAt: invoices.dueAt, amountCents: invoices.amountCents,
    paidCents: invoices.paidCents, status: invoices.status, parentInvoiceId: invoices.parentInvoiceId,
  }).from(invoices).all().filter((row) =>
    !demoPublic || DEMO_ROOTS.get(row.parentInvoiceId ?? row.id) === row.clientId);
  const visibleIds = new Set(invoiceRows.map(({ id }) => id));

  const payments = db.select({ invoiceId: auditLog.invoiceId, at: auditLog.at })
    .from(auditLog).where(and(
      eq(auditLog.actor, "paypal"),
      eq(auditLog.action, "reconcile.invoice.paid"),
      eq(auditLog.ok, true),
      isNotNull(auditLog.invoiceId),
      sql`json_extract(${auditLog.inputJson}, '$.previousStatus') <> 'PAID'`,
    )).all();
  const escalations = db.select({ invoiceId: approvals.invoiceId, at: approvals.createdAt })
    .from(approvals).where(eq(approvals.kind, "DISCOUNT_REQUEST")).all();
  const events: ReliabilityEvent[] = [
    ...payments.flatMap(({ invoiceId, at }): ReliabilityEvent[] =>
      invoiceId && visibleIds.has(invoiceId) ? [{ kind: "payment_observed", invoiceId, at }] : []),
    ...escalations.flatMap(({ invoiceId, at }): ReliabilityEvent[] =>
      visibleIds.has(invoiceId) ? [{ kind: "discount_escalation", invoiceId, at }] : []),
  ];
  return computeReliability(
    visibleClients,
    invoiceRows.filter((row) => row.parentInvoiceId === null),
    invoiceRows.filter((row) => row.parentInvoiceId !== null),
    events,
    getNow(db),
  );
}
