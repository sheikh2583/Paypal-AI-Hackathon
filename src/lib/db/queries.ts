import { and, desc, eq, isNotNull, notInArray } from "drizzle-orm";
import type {
  ApprovalKind,
  ApprovalRow,
  ApprovalStatus,
  AuditEntry,
  ChatMessage,
  ClientRow,
  InvoiceRow,
  InvoiceStatus,
  OwnerPolicy,
  PlanRow,
  PlanStatus,
} from "../types";
import { db, type AppDb } from "./client";
import {
  approvals,
  auditLog,
  clients,
  invoices,
  kv,
  messages,
  mockPaypalInvoices,
  ownerPolicy,
  plans,
  webhookEvents,
} from "./schema";

const DEFAULT_POLICY_ID = "default";

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function mapInvoice(row: typeof invoices.$inferSelect): InvoiceRow {
  return {
    id: row.id,
    paypalInvoiceId: row.paypalInvoiceId,
    paypalInvoiceUrl: row.paypalInvoiceUrl,
    clientId: row.clientId,
    number: row.number,
    description: row.description,
    amountCents: row.amountCents,
    paidCents: row.paidCents,
    currency: "USD",
    issuedAt: row.issuedAt,
    dueAt: row.dueAt,
    status: row.status as InvoiceStatus,
    parentInvoiceId: row.parentInvoiceId,
    planId: row.planId,
    installmentNo: row.installmentNo,
    chaseState: row.chaseState,
    riskScore: row.riskScore,
    riskFactors: parseJson(row.riskFactorsJson, []),
    riskExplanation: row.riskExplanation,
    lastAgentRunAt: row.lastAgentRunAt,
    nextFollowupAt: row.nextFollowupAt,
  };
}

function mapClient(row: typeof clients.$inferSelect): ClientRow {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    persona: row.persona,
    lateCount: row.lateCount,
    avgDaysLate: row.avgDaysLate,
    responsiveness: row.responsiveness,
    notes: row.notes,
  };
}

function mapPlan(row: typeof plans.$inferSelect): PlanRow {
  return {
    id: row.id,
    invoiceId: row.invoiceId,
    status: row.status as PlanStatus,
    discountPercent: row.discountPercent,
    totalCents: row.totalCents,
    installments: parseJson(row.installmentsJson, []),
    createdBy: row.createdBy,
    approvedBy: row.approvedBy,
    createdAt: row.createdAt,
  };
}

function mapApproval(row: typeof approvals.$inferSelect): ApprovalRow {
  return {
    id: row.id,
    invoiceId: row.invoiceId,
    planId: row.planId,
    kind: row.kind as ApprovalKind,
    reason: row.reason,
    recommendation: row.recommendation,
    status: row.status as ApprovalStatus,
    ownerResponse: row.ownerResponse,
    createdAt: row.createdAt,
    resolvedAt: row.resolvedAt,
  };
}

function mapAudit(row: typeof auditLog.$inferSelect): AuditEntry {
  return {
    id: row.id,
    at: row.at,
    actor: row.actor as AuditEntry["actor"],
    action: row.action,
    invoiceId: row.invoiceId,
    input: parseJson(row.inputJson, null),
    result: parseJson(row.resultJson, null),
    ok: row.ok,
  };
}

export type InvoiceWithClient = {
  invoice: InvoiceRow;
  client: ClientRow;
  latestChaseState: InvoiceRow["chaseState"];
};

/** Read invoices with their client row; chase state is the persisted latest state on the invoice. */
export function listInvoices(database: AppDb = db): InvoiceWithClient[] {
  return database
    .select({ invoice: invoices, client: clients })
    .from(invoices)
    .innerJoin(clients, eq(invoices.clientId, clients.id))
    .orderBy(desc(invoices.dueAt), desc(invoices.id))
    .all()
    .map(({ invoice, client }) => ({
      invoice: mapInvoice(invoice),
      client: mapClient(client),
      latestChaseState: invoice.chaseState,
    }));
}

export function getInvoice(id: string, database: AppDb = db): InvoiceRow | undefined {
  const row = database.select().from(invoices).where(eq(invoices.id, id)).limit(1).all()[0];
  return row ? mapInvoice(row) : undefined;
}

export function getClient(id: string, database: AppDb = db): ClientRow | undefined {
  const row = database.select().from(clients).where(eq(clients.id, id)).limit(1).all()[0];
  return row ? mapClient(row) : undefined;
}

/** Returns all local invoice rows that share the given planId (installment siblings). */
export function listInvoicesByPlanId(planId: string, database: AppDb = db): InvoiceRow[] {
  return database
    .select()
    .from(invoices)
    .where(eq(invoices.planId, planId))
    .all()
    .map(mapInvoice);
}

/** Returns all plans for a given invoice id. */
export function listPlansByInvoiceId(invoiceId: string, database: AppDb = db): PlanRow[] {
  return database
    .select()
    .from(plans)
    .where(eq(plans.invoiceId, invoiceId))
    .orderBy(desc(plans.createdAt))
    .all()
    .map(mapPlan);
}

export function getMessages(invoiceId: string, database: AppDb = db): ChatMessage[] {
  return database
    .select()
    .from(messages)
    .where(eq(messages.invoiceId, invoiceId))
    .orderBy(messages.createdAt, messages.id)
    .all()
    .map((row) => ({
      id: row.id,
      invoiceId: row.invoiceId,
      direction: row.direction,
      body: row.body,
      createdAt: row.createdAt,
    }));
}

export function insertMessage(message: ChatMessage, database: AppDb = db): ChatMessage {
  database.insert(messages).values(message).run();
  return message;
}

export function getPolicy(database: AppDb = db): OwnerPolicy | undefined {
  const row = database
    .select()
    .from(ownerPolicy)
    .where(eq(ownerPolicy.id, DEFAULT_POLICY_ID))
    .limit(1)
    .all()[0];
  if (!row) return undefined;
  return {
    minDepositPercent: row.minDepositPercent,
    maxInstallments: row.maxInstallments,
    maxPlanDays: row.maxPlanDays,
    maxDiscountPercent: row.maxDiscountPercent,
    autoApproveBelowCents: row.autoApproveBelowCents,
    tone: row.tone,
    businessName: row.businessName,
    ownerName: row.ownerName,
    updatedAt: row.updatedAt,
  };
}

export function upsertPolicy(policy: OwnerPolicy, database: AppDb = db): OwnerPolicy {
  database
    .insert(ownerPolicy)
    .values({ id: DEFAULT_POLICY_ID, ...policy })
    .onConflictDoUpdate({
      target: ownerPolicy.id,
      set: {
        minDepositPercent: policy.minDepositPercent,
        maxInstallments: policy.maxInstallments,
        maxPlanDays: policy.maxPlanDays,
        maxDiscountPercent: policy.maxDiscountPercent,
        autoApproveBelowCents: policy.autoApproveBelowCents,
        tone: policy.tone,
        businessName: policy.businessName,
        ownerName: policy.ownerName,
        updatedAt: policy.updatedAt,
      },
    })
    .run();
  return policy;
}

export function listApprovals(status?: ApprovalStatus, database: AppDb = db): ApprovalRow[] {
  const query = database.select().from(approvals);
  const rows = status
    ? query.where(eq(approvals.status, status)).orderBy(desc(approvals.createdAt), desc(approvals.id)).all()
    : query.orderBy(desc(approvals.createdAt), desc(approvals.id)).all();
  return rows.map(mapApproval);
}

export type NewApproval = Omit<ApprovalRow, "id"> & { id?: string };

export function insertApproval(input: NewApproval, database: AppDb = db): ApprovalRow {
  const row: ApprovalRow = { ...input, id: input.id ?? crypto.randomUUID() };
  database.insert(approvals).values(row).run();
  return row;
}

export function resolveApproval(
  id: string,
  status: Exclude<ApprovalStatus, "PENDING">,
  ownerResponse: string,
  resolvedAt = new Date().toISOString(),
  database: AppDb = db,
): ApprovalRow | undefined {
  const row = database
    .update(approvals)
    .set({ status, ownerResponse, resolvedAt })
    .where(eq(approvals.id, id))
    .returning()
    .all()[0];
  return row ? mapApproval(row) : undefined;
}

export type NewAuditEntry = Omit<AuditEntry, "id"> & { id?: string };

export function insertAudit(input: NewAuditEntry, database: AppDb = db): AuditEntry {
  const row: AuditEntry = { ...input, id: input.id ?? crypto.randomUUID() };
  database
    .insert(auditLog)
    .values({
      id: row.id,
      at: row.at,
      actor: row.actor,
      action: row.action,
      invoiceId: row.invoiceId,
      inputJson: JSON.stringify(row.input ?? null),
      resultJson: JSON.stringify(row.result ?? null),
      ok: row.ok,
    })
    .run();
  return row;
}

export function listAudit(invoiceId?: string, database: AppDb = db): AuditEntry[] {
  const query = database.select().from(auditLog);
  const rows = invoiceId
    ? query.where(eq(auditLog.invoiceId, invoiceId)).orderBy(desc(auditLog.at), desc(auditLog.id)).all()
    : query.orderBy(desc(auditLog.at), desc(auditLog.id)).all();
  return rows.map(mapAudit);
}

export function getPlan(id: string, database: AppDb = db): PlanRow | undefined {
  const row = database.select().from(plans).where(eq(plans.id, id)).limit(1).all()[0];
  return row ? mapPlan(row) : undefined;
}

export function insertPlan(plan: PlanRow, database: AppDb = db): PlanRow {
  database
    .insert(plans)
    .values({
      id: plan.id,
      invoiceId: plan.invoiceId,
      status: plan.status,
      discountPercent: plan.discountPercent,
      totalCents: plan.totalCents,
      installmentsJson: JSON.stringify(plan.installments),
      createdBy: plan.createdBy,
      approvedBy: plan.approvedBy,
      createdAt: plan.createdAt,
    })
    .run();
  return plan;
}

export type PlanUpdate = Partial<
  Pick<PlanRow, "status" | "discountPercent" | "totalCents" | "installments" | "createdBy" | "approvedBy">
>;

export function updatePlan(id: string, update: PlanUpdate, database: AppDb = db): PlanRow | undefined {
  const { installments, ...rest } = update;
  const set = {
    ...rest,
    ...(installments ? { installmentsJson: JSON.stringify(installments) } : {}),
  };
  const row = database.update(plans).set(set).where(eq(plans.id, id)).returning().all()[0];
  return row ? mapPlan(row) : undefined;
}

export type WebhookEventInput = {
  id: string;
  eventType: string;
  payload: unknown;
  receivedAt?: string;
};

/** Inserts the event once; returns false when this event id was already recorded. */
export function upsertWebhookEvent(event: WebhookEventInput, database: AppDb = db): boolean {
  const inserted = database
    .insert(webhookEvents)
    .values({
      id: event.id,
      eventType: event.eventType,
      payloadJson: JSON.stringify(event.payload ?? null),
      receivedAt: event.receivedAt ?? new Date().toISOString(),
    })
    .onConflictDoNothing({ target: webhookEvents.id })
    .returning({ id: webhookEvents.id })
    .all();
  return inserted.length > 0;
}

export function getKv(key: string, database: AppDb = db): string | undefined {
  return database.select({ value: kv.value }).from(kv).where(eq(kv.key, key)).limit(1).all()[0]?.value;
}

export function setKv(key: string, value: string, database: AppDb = db): void {
  database
    .insert(kv)
    .values({ key, value })
    .onConflictDoUpdate({ target: kv.key, set: { value } })
    .run();
}

// ---------------------------------------------------------------------------
// Invoice updates (used by reconciler and plan handlers)
// ---------------------------------------------------------------------------

export type InvoiceUpdate = Partial<
  Pick<InvoiceRow, "status" | "paidCents" | "paypalInvoiceId" | "paypalInvoiceUrl" | "chaseState" | "planId" | "lastAgentRunAt" | "nextFollowupAt" | "riskScore" | "riskExplanation">
>;

export function updateInvoice(id: string, update: InvoiceUpdate, database: AppDb = db): InvoiceRow | undefined {
  const row = database.update(invoices).set(update).where(eq(invoices.id, id)).returning().all()[0];
  return row ? mapInvoice(row) : undefined;
}

// ---------------------------------------------------------------------------
// Mock PayPal invoice helpers (PAYPAL_MODE=mock only)
// ---------------------------------------------------------------------------

export interface MockPayPalInvoiceRow {
  id: string;
  number: string;
  amountCents: number;
  paidCents: number;
  status: string;
  recipientViewUrl: string;
  createdAt: string;
}

function mapMockInvoice(row: typeof mockPaypalInvoices.$inferSelect): MockPayPalInvoiceRow {
  return {
    id: row.id,
    number: row.number,
    amountCents: row.amountCents,
    paidCents: row.paidCents,
    status: row.status,
    recipientViewUrl: row.recipientViewUrl,
    createdAt: row.createdAt,
  };
}

export function insertMockPaypalInvoice(
  invoice: MockPayPalInvoiceRow,
  database: AppDb = db,
): MockPayPalInvoiceRow {
  database.insert(mockPaypalInvoices).values(invoice).run();
  return invoice;
}

export function getMockPaypalInvoice(
  id: string,
  database: AppDb = db,
): MockPayPalInvoiceRow | undefined {
  const row = database
    .select()
    .from(mockPaypalInvoices)
    .where(eq(mockPaypalInvoices.id, id))
    .limit(1)
    .all()[0];
  return row ? mapMockInvoice(row) : undefined;
}

export type MockPayPalInvoiceUpdate = Partial<Pick<MockPayPalInvoiceRow, "status" | "paidCents">>;

export function updateMockPaypalInvoice(
  id: string,
  update: MockPayPalInvoiceUpdate,
  database: AppDb = db,
): MockPayPalInvoiceRow | undefined {
  const row = database
    .update(mockPaypalInvoices)
    .set(update)
    .where(eq(mockPaypalInvoices.id, id))
    .returning()
    .all()[0];
  return row ? mapMockInvoice(row) : undefined;
}

/** Returns all local invoices that have a paypal_invoice_id and are not in a terminal state. */
export function listReconcilableInvoices(database: AppDb = db): InvoiceRow[] {
  const terminalStatuses: InvoiceStatus[] = ["PAID", "CANCELLED", "SUPERSEDED"];
  return database
    .select()
    .from(invoices)
    .where(and(isNotNull(invoices.paypalInvoiceId), notInArray(invoices.status, terminalStatuses)))
    .all()
    .map(mapInvoice);
}
