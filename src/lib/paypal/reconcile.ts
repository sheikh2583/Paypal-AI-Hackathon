import { db, type AppDb } from "../db/client";
import {
  getInvoiceByPayPalId, getPlan, insertApproval, listApprovals, listInvoicesByPlanId,
  listReconcilableInvoices, updateInvoice, updatePlan,
} from "../db/queries";
import { audit } from "../audit";
import { emit, type AppEvent } from "../events";
import { getNow } from "../clock";
import { getPayPal } from "./index";
import { refreshRisk } from "../risk/service";
import type { InvoiceRow, PayPalClient, PayPalInvoice } from "../types";

function updatePlanProgress(invoice: InvoiceRow, database: AppDb, at: string): AppEvent | undefined {
  if (!invoice.planId || !invoice.parentInvoiceId) return;
  const plan = getPlan(invoice.planId, database);
  if (!plan || plan.invoiceId !== invoice.parentInvoiceId || !["ACTIVE", "RESOLVED"].includes(plan.status)) return;

  const installments = listInvoicesByPlanId(plan.id, database).filter((row) => row.parentInvoiceId === plan.invoiceId);
  const paid = plan.installments.filter(({ no }) =>
    installments.some((row) => row.installmentNo === no && row.status === "PAID"),
  ).length;
  const complete = paid > 0 && paid === plan.installments.length;
  const status = complete ? "RESOLVED" : "ACTIVE";
  if (plan.status !== status) {
    updatePlan(plan.id, { status }, database);
    updateInvoice(plan.invoiceId, {
      chaseState: complete ? "RESOLVED" : "PLAN_ACTIVE",
      nextFollowupAt: null,
    }, database);
  }
  audit({
    actor: "paypal", action: "reconcile.plan.progress", invoiceId: plan.invoiceId,
    input: { planId: plan.id, installmentId: invoice.id },
    result: { status, paidInstallments: paid, totalInstallments: plan.installments.length }, ok: true,
  }, database, at);
  return { type: "invoice.updated", invoiceId: plan.invoiceId, at };
}

function applySnapshot(paypalInvoiceId: string, remote: PayPalInvoice, database: AppDb, at: string): AppEvent[] {
  const invoice = getInvoiceByPayPalId(paypalInvoiceId, database);
  if (!invoice) return [];

  if (invoice.status === "SUPERSEDED") {
    if (remote.paidCents <= 0 || listApprovals("PENDING", database).some(
      (entry) => entry.invoiceId === invoice.id && entry.kind === "UNEXPECTED_PAYMENT",
    )) return [];

    insertApproval({
      invoiceId: invoice.id, planId: invoice.planId, kind: "UNEXPECTED_PAYMENT",
      reason: `Payment of ${remote.paidCents} cents received on a superseded invoice.`,
      recommendation: "Review and decide whether to credit toward the plan or refund.",
      status: "PENDING", ownerResponse: null, createdAt: at, resolvedAt: null,
    }, database);
    audit({
      actor: "paypal", action: "reconcile.unexpected_payment", invoiceId: invoice.id,
      input: { paypalInvoiceId, paidCents: remote.paidCents },
      result: { approval: "UNEXPECTED_PAYMENT" }, ok: true,
    }, database, at);
    return [{ type: "approval.created", invoiceId: invoice.id, at }];
  }

  const status = remote.status;
  if (status !== "PAID" && status !== "PARTIALLY_PAID" && status !== "CANCELLED") return [];
  if (status === invoice.status && remote.paidCents === invoice.paidCents) return [];

  updateInvoice(invoice.id, {
    status, paidCents: remote.paidCents,
    ...(status === "PAID" ? { chaseState: "RESOLVED" as const } : {}),
    ...(status !== "PARTIALLY_PAID" ? { nextFollowupAt: null } : {}),
  }, database);
  audit({
    actor: "paypal", action: `reconcile.invoice.${status.toLowerCase()}`, invoiceId: invoice.id,
    input: { paypalInvoiceId, previousStatus: invoice.status, previousPaidCents: invoice.paidCents },
    result: { status, paidCents: remote.paidCents }, ok: true,
  }, database, at);

  const events: AppEvent[] = [{ type: "invoice.updated", invoiceId: invoice.id, at }];
  if (status !== "CANCELLED" && (remote.paidCents > invoice.paidCents || status === "PAID" && invoice.status !== "PAID")) {
    events.push({ type: "invoice.paid", invoiceId: invoice.id, at });
  }
  const planEvent = updatePlanProgress(invoice, database, at);
  if (planEvent) events.push(planEvent);
  return events;
}

// Serialize fetch-and-apply per invoice so an older poll cannot undo a newer webhook snapshot.
const invoiceQueues = new WeakMap<AppDb, Map<string, Promise<unknown>>>();

export async function reconcilePayPalInvoice(
  paypalInvoiceId: string,
  database: AppDb = db,
  paypal: PayPalClient = getPayPal(undefined, database),
): Promise<"unknown" | "updated" | "unchanged"> {
  let queue = invoiceQueues.get(database);
  if (!queue) {
    queue = new Map();
    invoiceQueues.set(database, queue);
  }
  const previous = queue.get(paypalInvoiceId);
  const work = (async () => {
    await previous?.catch(() => undefined);
    const invoice = getInvoiceByPayPalId(paypalInvoiceId, database);
    if (!invoice) return "unknown" as const;
    const remote = await paypal.getInvoice(paypalInvoiceId);
    if (remote.paypalInvoiceId !== paypalInvoiceId || !Number.isSafeInteger(remote.paidCents) || remote.paidCents < 0) {
      throw new Error("INVALID_PAYPAL_INVOICE");
    }
    const now = getNow(database);
    const events = database.$client.transaction(() => applySnapshot(paypalInvoiceId, remote, database, now.toISOString()))();
    if (events.some((event) => event.type === "invoice.updated" && event.invoiceId === invoice.id)) {
      try {
        await refreshRisk(invoice.id, database, now, { explain: 'template' });
      } catch {
        audit({ actor: "paypal", action: "reconcile.risk.error", invoiceId: invoice.id, ok: false }, database, now.toISOString());
      }
    }
    for (const event of events) emit(event);
    return events.length > 0 ? "updated" as const : "unchanged" as const;
  })();
  queue.set(paypalInvoiceId, work);
  try {
    return await work;
  } finally {
    if (queue.get(paypalInvoiceId) === work) queue.delete(paypalInvoiceId);
  }
}

export async function reconcilePayPalInvoices(database: AppDb = db, paypal = getPayPal(undefined, database)): Promise<void> {
  for (const invoice of listReconcilableInvoices(database)) {
    if (!invoice.paypalInvoiceId) continue;
    try {
      await reconcilePayPalInvoice(invoice.paypalInvoiceId, database, paypal);
    } catch {
      audit({
        actor: "paypal", action: "reconcile.get_invoice.error", invoiceId: invoice.id,
        input: { paypalInvoiceId: invoice.paypalInvoiceId }, ok: false,
      }, database, getNow(database).toISOString());
    }
  }
}

