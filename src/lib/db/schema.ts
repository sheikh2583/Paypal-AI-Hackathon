import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type {
  ApprovalKind,
  ApprovalStatus,
  ChaseState,
  InvoiceStatus,
  PlanStatus,
} from "../types";

export const ownerPolicy = sqliteTable(
  "owner_policy",
  {
    id: text("id").primaryKey(),
    minDepositPercent: integer("min_deposit_percent").notNull(),
    maxInstallments: integer("max_installments").notNull(),
    maxPlanDays: integer("max_plan_days").notNull(),
    maxDiscountPercent: integer("max_discount_percent").notNull(),
    autoApproveBelowCents: integer("auto_approve_below_cents").notNull(),
    tone: text("tone", { enum: ["friendly", "firm"] }).notNull(),
    businessName: text("business_name").notNull(),
    ownerName: text("owner_name").notNull(),
    // updated_at tracks when the owner last changed policy settings
    updatedAt: text("updated_at").notNull().default(""),
  },
);

export const clients = sqliteTable(
  "clients",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    persona: text("persona"),
    lateCount: integer("late_count").notNull().default(0),
    avgDaysLate: real("avg_days_late").notNull().default(0),
    responsiveness: text("responsiveness", { enum: ["high", "medium", "low"] }).notNull(),
    notes: text("notes"),
  },
  // No UNIQUE on email: in sandbox mode all clients share PAYPAL_SANDBOX_BUYER_EMAIL (docs/03)
);

export const invoices = sqliteTable(
  "invoices",
  {
    id: text("id").primaryKey(),
    paypalInvoiceId: text("paypal_invoice_id"),
    paypalInvoiceUrl: text("paypal_invoice_url"),
    clientId: text("client_id").notNull().references(() => clients.id),
    number: text("number").notNull(),
    description: text("description").notNull(),
    amountCents: integer("amount_cents").notNull(),
    paidCents: integer("paid_cents").notNull().default(0),
    currency: text("currency", { enum: ["USD"] }).notNull().default("USD"),
    issuedAt: text("issued_at").notNull(),
    dueAt: text("due_at").notNull(),
    status: text("status", {
      enum: ["SENT", "OVERDUE", "PARTIALLY_PAID", "PAID", "CANCELLED", "SUPERSEDED"],
    }).$type<InvoiceStatus>().notNull(),
    parentInvoiceId: text("parent_invoice_id").references((): AnySQLiteColumn => invoices.id),
    planId: text("plan_id"),
    installmentNo: integer("installment_no"),
    chaseState: text("chase_state", {
      enum: ["NEW", "NUDGED", "NEGOTIATING", "PLAN_OFFERED", "PLAN_ACCEPTED", "PLAN_ACTIVE", "ESCALATED", "RESOLVED"],
    }).$type<ChaseState>().notNull().default("NEW"),
    riskScore: integer("risk_score"),
    riskFactorsJson: text("risk_factors").notNull().default("[]"),
    riskExplanation: text("risk_explanation"),
    lastAgentRunAt: text("last_agent_run_at"),
    nextFollowupAt: text("next_followup_at"),
  },
  (table) => [
    index("invoices_client_id_idx").on(table.clientId),
    // Composite index matching docs/03: (status, due_at) for the main query path
    index("invoices_status_due_at_idx").on(table.status, table.dueAt),
    index("invoices_next_followup_at_idx").on(table.nextFollowupAt),
    index("invoices_parent_invoice_id_idx").on(table.parentInvoiceId),
    index("invoices_plan_id_idx").on(table.planId),
    uniqueIndex("invoices_number_idx").on(table.number),
  ],
);

export const plans = sqliteTable(
  "plans",
  {
    id: text("id").primaryKey(),
    invoiceId: text("invoice_id").notNull().references(() => invoices.id),
    status: text("status", {
      enum: ["OFFERED", "ACCEPTED", "ACTIVE", "RESOLVED", "REJECTED", "EXPIRED", "PENDING_APPROVAL"],
    }).$type<PlanStatus>().notNull(),
    discountPercent: integer("discount_percent").notNull(),
    totalCents: integer("total_cents").notNull(),
    installmentsJson: text("installments_json").notNull(),
    createdBy: text("created_by", { enum: ["agent", "owner"] }).notNull(),
    approvedBy: text("approved_by", { enum: ["policy", "owner"] }),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("plans_invoice_id_idx").on(table.invoiceId),
    index("plans_status_idx").on(table.status),
  ],
);

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    invoiceId: text("invoice_id").notNull().references(() => invoices.id),
    direction: text("direction", {
      enum: ["agent_to_client", "client_to_agent", "system", "owner_note"],
    }).notNull(),
    body: text("body").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("messages_invoice_created_at_idx").on(table.invoiceId, table.createdAt),
  ],
);

export const approvals = sqliteTable(
  "approvals",
  {
    id: text("id").primaryKey(),
    invoiceId: text("invoice_id").notNull().references(() => invoices.id),
    planId: text("plan_id").references(() => plans.id),
    kind: text("kind", {
      enum: [
        "PLAN_OUT_OF_BOUNDS", "PLAN_NEEDS_SIGNOFF", "DISCOUNT_REQUEST", "DISPUTE",
        "UNCLEAR", "ABUSE", "UNEXPECTED_PAYMENT", "PAYPAL_ERROR",
      ],
    }).$type<ApprovalKind>().notNull(),
    reason: text("reason").notNull(),
    recommendation: text("recommendation").notNull(),
    status: text("status", { enum: ["PENDING", "APPROVED", "REJECTED", "EDITED"] })
      .$type<ApprovalStatus>().notNull().default("PENDING"),
    ownerResponse: text("owner_response"),
    createdAt: text("created_at").notNull(),
    resolvedAt: text("resolved_at"),
  },
  (table) => [
    index("approvals_status_created_at_idx").on(table.status, table.createdAt),
    index("approvals_invoice_id_idx").on(table.invoiceId),
    index("approvals_plan_id_idx").on(table.planId),
  ],
);

export const auditLog = sqliteTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    at: text("at").notNull(),
    actor: text("actor", { enum: ["agent", "owner", "system", "paypal"] }).notNull(),
    action: text("action").notNull(),
    invoiceId: text("invoice_id"),
    inputJson: text("input_json").notNull(),
    resultJson: text("result_json").notNull(),
    ok: integer("ok", { mode: "boolean" }).notNull(),
  },
  (table) => [
    index("audit_log_at_idx").on(table.at),
    index("audit_log_invoice_at_idx").on(table.invoiceId, table.at),
  ],
);

export const webhookEvents = sqliteTable(
  "webhook_events",
  {
    id: text("id").primaryKey(),
    // docs/03 calls this "type"; stored as "event_type" to avoid the SQL reserved word.
    // Renaming would require a destructive table rebuild on Render (no TTY for drizzle push).
    // D44: decision to keep event_type and document the deviation.
    eventType: text("event_type").notNull(),
    payloadJson: text("payload_json").notNull(),
    receivedAt: text("received_at").notNull(),
    // processed_at is set when the webhook handler finishes (null = pending/failed)
    processedAt: text("processed_at"),
  },
  (table) => [index("webhook_events_received_at_idx").on(table.receivedAt)],
);

export const mockPaypalInvoices = sqliteTable(
  "mock_paypal_invoices",
  {
    id: text("id").primaryKey(),
    number: text("number").notNull(),
    amountCents: integer("amount_cents").notNull(),
    paidCents: integer("paid_cents").notNull().default(0),
    status: text("status").notNull(),
    recipientViewUrl: text("recipient_view_url").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [uniqueIndex("mock_paypal_invoices_number_idx").on(table.number)],
);

export const kv = sqliteTable("kv", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

/** Used only to enforce one-time email-verification links; tokens are SHA-256 digests. */
export const authEmailVerificationTokens = sqliteTable("auth_email_verification_tokens", {
  tokenHash: text("token_hash").primaryKey(),
  expiresAt: text("expires_at").notNull(),
});

export const schema = {
  ownerPolicy,
  clients,
  invoices,
  plans,
  messages,
  approvals,
  auditLog,
  webhookEvents,
  mockPaypalInvoices,
  kv,
  authEmailVerificationTokens,
};
