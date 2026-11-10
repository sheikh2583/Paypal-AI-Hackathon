// Agent tool definitions and handlers. Each tool is Zod-validated on input,
// calls only sanctioned DB/PayPal paths, and writes an audit row (hard rule 5).
// Money is always integer cents (hard rule 1). Contracts in docs/04.
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { AppDb } from '../db/client';
import { invoices as invoicesTable } from '../db/schema';
import type {
  ApprovalKind,
  ChaseState,
  InvoiceRow,
  Installment,
  PayPalClient,
  PlanProposal,
} from '../types';
import { audit } from '../audit';
import { emit } from '../events';
import { evaluatePlan, rebasePlan, remainingCents, discountedTotal } from '../policy';
import { getPayPal } from '../paypal/index';
import { refreshRisk } from '../risk/service';
import {
  getInvoice,
  getClient,
  getMessages,
  getPolicy,
  getPlan,
  listInvoicesByPlanId,
  insertApproval,
  insertMessage,
  insertPlan,
  listAudit,
  updateInvoice,
  updatePlan,
} from '../db/queries';
import type { ToolDefinition } from '../llm';
import { getLlmEnv, getPayPalEnv } from '../env';

// ---------------------------------------------------------------------------
// Helpers: functions not yet in queries.ts
// ---------------------------------------------------------------------------

/** Simple URL extraction regex (D7 allowlist). */
const URL_REGEX = /https?:\/\/[^\s"'<>)]+/g;

/** Returns the set of allowed URLs for a given invoice (its own + plan siblings). */
function allowedUrlsForInvoice(invoice: InvoiceRow, database: AppDb): Set<string> {
  const urls = new Set<string>();
  if (invoice.paypalInvoiceUrl) urls.add(invoice.paypalInvoiceUrl);
  if (invoice.planId) {
    const siblings = listInvoicesByPlanId(invoice.planId, database);
    for (const sib of siblings) {
      if (sib.paypalInvoiceUrl) urls.add(sib.paypalInvoiceUrl);
    }
  }
  return urls;
}

/** Calculates days overdue from dueAt ISO string and now. */
function daysOverdue(dueAt: string, now: Date): number {
  const dueMs = Date.parse(dueAt.length === 10 ? `${dueAt}T00:00:00.000Z` : dueAt);
  return Math.max(0, Math.floor((now.getTime() - dueMs) / (24 * 60 * 60 * 1000)));
}

/** Counts agent messages since the last client message (unanswered nudges). */
function countUnansweredNudges(invoiceId: string, database: AppDb): number {
  const msgs = getMessages(invoiceId, database);
  let count = 0;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i]!;
    if (m.direction === 'client_to_agent') break;
    if (m.direction === 'agent_to_client') count++;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const GET_INVOICE_CONTEXT_DEF: ToolDefinition = {
  name: 'get_invoice_context',
  description:
    'Returns invoice, client, policy, risk, and recent message context. Call first before taking action.',
  inputSchema: {
    type: 'object',
    properties: {
      invoiceId: { type: 'string', description: 'Local invoice ID.' },
    },
    required: ['invoiceId'],
  },
};

const SEND_MESSAGE_DEF: ToolDefinition = {
  name: 'send_message',
  description:
    'Sends a message to the client on behalf of the owner. Body max 900 chars. Only the invoice PayPal URL (or plan installment URLs) may be included as links.',
  inputSchema: {
    type: 'object',
    properties: {
      invoiceId: { type: 'string', description: 'Local invoice ID.' },
      body: { type: 'string', description: 'Message text, max 900 characters.' },
    },
    required: ['invoiceId', 'body'],
  },
};

const PROPOSE_PAYMENT_PLAN_DEF: ToolDefinition = {
  name: 'propose_payment_plan',
  description:
    'Proposes a payment plan for an overdue invoice. Policy is enforced automatically — if violations are returned, adjust the proposal. Plans above the auto-approve threshold go to the owner for sign-off; tell the client you are confirming with the owner, never share terms until approved.',
  inputSchema: {
    type: 'object',
    properties: {
      invoiceId: { type: 'string', description: 'Local invoice ID.' },
      discountPercent: { type: 'number', description: 'Discount percentage (0-100).' },
      installments: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            no: { type: 'integer', description: 'Installment number (1-based).' },
            amountCents: { type: 'integer', description: 'Amount in cents (integer).' },
            dueAt: { type: 'string', description: 'ISO date string (YYYY-MM-DD).' },
          },
          required: ['no', 'amountCents', 'dueAt'],
        },
        description: 'Ordered list of installments. First is the deposit.',
      },
    },
    required: ['invoiceId', 'discountPercent', 'installments'],
  },
};

const CREATE_PLAN_INVOICES_DEF: ToolDefinition = {
  name: 'create_plan_invoices',
  description:
    'Creates and sends PayPal invoices for each installment of an ACCEPTED plan. Idempotent — safe to call twice. Only call after plan status is ACCEPTED.',
  inputSchema: {
    type: 'object',
    properties: {
      planId: { type: 'string', description: 'Plan ID.' },
    },
    required: ['planId'],
  },
};

const ESCALATE_TO_OWNER_DEF: ToolDefinition = {
  name: 'escalate_to_owner',
  description:
    'Escalates an issue to the owner for review. Use for out-of-bounds requests, disputes, abusive messages, or unclear situations.',
  inputSchema: {
    type: 'object',
    properties: {
      invoiceId: { type: 'string', description: 'Local invoice ID.' },
      kind: {
        type: 'string',
        enum: ['PLAN_OUT_OF_BOUNDS', 'PLAN_NEEDS_SIGNOFF', 'DISCOUNT_REQUEST', 'DISPUTE', 'UNCLEAR', 'ABUSE', 'UNEXPECTED_PAYMENT', 'PAYPAL_ERROR'],
        description: 'Approval kind.',
      },
      reason: { type: 'string', description: 'What is happening and why it needs owner review.' },
      recommendation: { type: 'string', description: 'What the agent recommends the owner do.' },
    },
    required: ['invoiceId', 'kind', 'reason', 'recommendation'],
  },
};

const SCHEDULE_FOLLOWUP_DEF: ToolDefinition = {
  name: 'schedule_followup',
  description: 'Schedules a follow-up agent run for this invoice N days from now (1-14 days).',
  inputSchema: {
    type: 'object',
    properties: {
      invoiceId: { type: 'string', description: 'Local invoice ID.' },
      inDays: {
        type: 'integer',
        description: 'Days from now to follow up (1-14).',
        minimum: 1,
        maximum: 14,
      },
    },
    required: ['invoiceId', 'inDays'],
  },
};

export const agentTools: ToolDefinition[] = [
  GET_INVOICE_CONTEXT_DEF,
  SEND_MESSAGE_DEF,
  PROPOSE_PAYMENT_PLAN_DEF,
  CREATE_PLAN_INVOICES_DEF,
  ESCALATE_TO_OWNER_DEF,
  SCHEDULE_FOLLOWUP_DEF,
];

// ---------------------------------------------------------------------------
// Zod schemas for tool inputs
// ---------------------------------------------------------------------------

const getInvoiceContextSchema = z.object({
  invoiceId: z.string().min(1),
});

const sendMessageSchema = z.object({
  invoiceId: z.string().min(1),
  body: z.string().max(900, 'Message body must be 900 characters or fewer'),
});

const installmentSchema = z.object({
  no: z.number().int().positive(),
  amountCents: z.number().int().positive(),
  dueAt: z.string().min(1),
});

const proposePlanSchema = z.object({
  invoiceId: z.string().min(1),
  discountPercent: z.number().min(0).max(100),
  installments: z.array(installmentSchema).min(1),
});

const createPlanInvoicesSchema = z.object({
  planId: z.string().min(1),
});

const escalateSchema = z.object({
  invoiceId: z.string().min(1),
  kind: z.enum(['PLAN_OUT_OF_BOUNDS', 'PLAN_NEEDS_SIGNOFF', 'DISCOUNT_REQUEST', 'DISPUTE', 'UNCLEAR', 'ABUSE', 'UNEXPECTED_PAYMENT', 'PAYPAL_ERROR']),
  reason: z.string().min(1),
  recommendation: z.string().min(1),
});

const scheduleFollowupSchema = z.object({
  invoiceId: z.string().min(1),
  inDays: z.number().int().min(1).max(14),
});

// Keep provider function declarations derived from the same schemas used to
// validate tool inputs, so weaker models cannot gain a looser interface.
const generatedSchemas: Record<string, z.ZodType> = {
  get_invoice_context: getInvoiceContextSchema,
  send_message: sendMessageSchema,
  propose_payment_plan: proposePlanSchema,
  create_plan_invoices: createPlanInvoicesSchema,
  escalate_to_owner: escalateSchema,
  schedule_followup: scheduleFollowupSchema,
};
for (const tool of agentTools) tool.inputSchema = z.toJSONSchema(generatedSchemas[tool.name]!);

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

async function handleGetInvoiceContext(
  rawInput: unknown,
  database: AppDb,
  now: Date,
): Promise<string> {
  const input = getInvoiceContextSchema.parse(rawInput);
  const invoice = getInvoice(input.invoiceId, database);
  if (!invoice) {
    return JSON.stringify({ error: 'INVOICE_NOT_FOUND', invoiceId: input.invoiceId });
  }
  const client = getClient(invoice.clientId, database);
  const policy = getPolicy(database);
  const msgs = getMessages(invoice.id, database).slice(-getLlmEnv().maxHistory);
  const unansweredNudges = countUnansweredNudges(invoice.id, database);
  const overdue = daysOverdue(invoice.dueAt, now);

  const context = {
    invoice: {
      id: invoice.id,
      number: invoice.number,
      description: invoice.description,
      amountCents: invoice.amountCents,
      paidCents: invoice.paidCents,
      dueAt: invoice.dueAt,
      daysOverdue: overdue,
      status: invoice.status,
      chaseState: invoice.chaseState,
      paypalInvoiceUrl: invoice.paypalInvoiceUrl,
    },
    client: client
      ? {
          name: client.name,
          lateCount: client.lateCount,
          avgDaysLate: client.avgDaysLate,
          responsiveness: client.responsiveness,
        }
      : null,
    risk: {
      score: invoice.riskScore ?? 0,
      factors: invoice.riskFactors,
      explanation: invoice.riskExplanation,
    },
    policySummary: policy
      ? {
          minDepositPercent: policy.minDepositPercent,
          maxInstallments: policy.maxInstallments,
          maxPlanDays: policy.maxPlanDays,
          maxDiscountPercent: policy.maxDiscountPercent,
          tone: policy.tone,
        }
      : null,
    messages: msgs.map((m) => ({
      direction: m.direction,
      body: m.body,
      createdAt: m.createdAt,
    })),
    unansweredNudges,
  };

  audit(
    {
      actor: 'agent',
      action: 'get_invoice_context',
      invoiceId: invoice.id,
      input: { invoiceId: input.invoiceId },
      result: { ok: true },
      ok: true,
    },
    database,
  );

  return JSON.stringify(context);
}

async function handleSendMessage(
  rawInput: unknown,
  database: AppDb,
  now: Date,
): Promise<string> {
  const parsed = sendMessageSchema.safeParse(rawInput);
  if (!parsed.success) {
    return JSON.stringify({ ok: false, error: 'VALIDATION_ERROR', details: parsed.error.issues });
  }
  const input = parsed.data;

  // Belt-and-suspenders length check (Zod max(900) already covers this).
  if (input.body.length > 900) {
    audit({ actor: 'agent', action: 'send_message', invoiceId: input.invoiceId, input, result: { ok: false, error: 'BODY_TOO_LONG' }, ok: false }, database);
    return JSON.stringify({ ok: false, error: 'BODY_TOO_LONG' });
  }

  const invoice = getInvoice(input.invoiceId, database);
  if (!invoice) {
    return JSON.stringify({ ok: false, error: 'INVOICE_NOT_FOUND' });
  }

  // URL allowlist check (D7 hard rule 7).
  const foundUrls = input.body.match(URL_REGEX) ?? [];
  if (foundUrls.length > 0) {
    const allowed = allowedUrlsForInvoice(invoice, database);
    const forbidden = foundUrls.filter((u) => !allowed.has(u));
    if (forbidden.length > 0) {
      audit({ actor: 'agent', action: 'send_message', invoiceId: input.invoiceId, input, result: { ok: false, error: 'URL_NOT_ALLOWED', forbidden }, ok: false }, database);
      return JSON.stringify({ ok: false, error: 'URL_NOT_ALLOWED', forbidden });
    }
  }

  const messageId = crypto.randomUUID();
  insertMessage(
    {
      id: messageId,
      invoiceId: invoice.id,
      direction: 'agent_to_client',
      body: input.body,
      createdAt: now.toISOString(),
    },
    database,
  );
  await refreshRisk(invoice.id, database, now);

  // Transition NEW → NUDGED on first send.
  if (invoice.chaseState === 'NEW') {
    updateInvoice(invoice.id, { chaseState: 'NUDGED' as ChaseState }, database);
  }

  audit({ actor: 'agent', action: 'send_message', invoiceId: invoice.id, input, result: { ok: true, messageId }, ok: true }, database);
  emit({ type: 'message.created', invoiceId: invoice.id, at: now.toISOString() });

  return JSON.stringify({ ok: true, messageId });
}

async function handleProposePaymentPlan(
  rawInput: unknown,
  database: AppDb,
  now: Date,
): Promise<string> {
  const parsed = proposePlanSchema.safeParse(rawInput);
  if (!parsed.success) {
    return JSON.stringify({ ok: false, error: 'VALIDATION_ERROR', details: parsed.error.issues });
  }
  const input = parsed.data;

  const invoice = getInvoice(input.invoiceId, database);
  if (!invoice) {
    return JSON.stringify({ ok: false, error: 'INVOICE_NOT_FOUND' });
  }

  // Eligibility: must be OVERDUE with zero paid (D6, evaluatePlan also checks this).
  if (invoice.status !== 'OVERDUE' || invoice.paidCents !== 0) {
    audit({ actor: 'agent', action: 'propose_payment_plan', invoiceId: invoice.id, input, result: { ok: false, error: 'INVOICE_NOT_ELIGIBLE' }, ok: false }, database);
    return JSON.stringify({ ok: false, error: 'INVOICE_NOT_ELIGIBLE' });
  }

  const policy = getPolicy(database);
  if (!policy) {
    return JSON.stringify({ ok: false, error: 'POLICY_NOT_FOUND' });
  }

  const proposal: PlanProposal = {
    invoiceId: input.invoiceId,
    discountPercent: input.discountPercent,
    installments: input.installments as Installment[],
  };

  const decision = evaluatePlan(policy, invoice, proposal, now);

  if (!decision.allowed) {
    audit({ actor: 'agent', action: 'propose_payment_plan', invoiceId: invoice.id, input, result: { ok: false, violations: decision.violations }, ok: false }, database);
    return JSON.stringify({ ok: false, violations: decision.violations });
  }

  const remaining = remainingCents(invoice);
  const total = discountedTotal(remaining, input.discountPercent);
  const planId = crypto.randomUUID();
  const planStatus = decision.needsOwnerApproval ? ('PENDING_APPROVAL' as const) : ('OFFERED' as const);

  insertPlan(
    {
      id: planId,
      invoiceId: invoice.id,
      status: planStatus,
      discountPercent: input.discountPercent,
      totalCents: total,
      installments: input.installments as Installment[],
      createdBy: 'agent',
      approvedBy: decision.needsOwnerApproval ? null : 'policy',
      createdAt: now.toISOString(),
    },
    database,
  );

  if (decision.needsOwnerApproval) {
    updateInvoice(invoice.id, { chaseState: 'ESCALATED' as ChaseState, planId }, database);
    insertApproval(
      {
        invoiceId: invoice.id,
        planId,
        kind: 'PLAN_NEEDS_SIGNOFF' as ApprovalKind,
        reason: `Plan total ${total} cents (≥ auto-approve threshold). Awaiting owner sign-off.`,
        recommendation: `Review the installments and approve or reject. Total: $${(total / 100).toFixed(2)}.`,
        status: 'PENDING',
        ownerResponse: null,
        createdAt: now.toISOString(),
        resolvedAt: null,
      },
      database,
    );
    audit({ actor: 'agent', action: 'propose_payment_plan', invoiceId: invoice.id, input, result: { ok: true, planId, planStatus, needsOwnerApproval: true }, ok: true }, database);
    emit({ type: 'approval.created', invoiceId: invoice.id, at: now.toISOString() });
    return JSON.stringify({
      ok: true,
      planId,
      planStatus: 'PENDING_APPROVAL',
      needsOwnerApproval: true,
      agentInstruction:
        'Tell the client you are confirming with the owner. Do NOT share plan terms until the owner approves.',
    });
  }

  // Auto-approved by policy.
  updateInvoice(invoice.id, { chaseState: 'PLAN_OFFERED' as ChaseState, planId }, database);
  audit({ actor: 'agent', action: 'propose_payment_plan', invoiceId: invoice.id, input, result: { ok: true, planId, planStatus }, ok: true }, database);
  emit({ type: 'invoice.updated', invoiceId: invoice.id, at: now.toISOString() });

  return JSON.stringify({ ok: true, planId, planStatus: 'OFFERED' });
}

async function handleCreatePlanInvoices(
  rawInput: unknown,
  database: AppDb,
  now: Date,
  paypalOverride?: PayPalClient,
): Promise<string> {
  const parsed = createPlanInvoicesSchema.safeParse(rawInput);
  if (!parsed.success) {
    return JSON.stringify({ ok: false, error: 'VALIDATION_ERROR', details: parsed.error.issues });
  }
  const input = parsed.data;

  const plan = getPlan(input.planId, database);
  if (!plan) {
    return JSON.stringify({ ok: false, error: 'PLAN_NOT_FOUND' });
  }

  // Idempotency: already active.
  if (plan.status === 'ACTIVE') {
    return JSON.stringify({ ok: true, alreadyDone: true });
  }

  if (plan.status !== 'ACCEPTED') {
    audit({ actor: 'agent', action: 'create_plan_invoices', invoiceId: plan.invoiceId, input, result: { ok: false, error: 'PLAN_NOT_ACCEPTED', status: plan.status }, ok: false }, database);
    return JSON.stringify({ ok: false, error: 'PLAN_NOT_ACCEPTED', currentStatus: plan.status });
  }

  const invoice = getInvoice(plan.invoiceId, database);
  if (!invoice) return JSON.stringify({ ok: false, error: 'INVOICE_NOT_FOUND' });

  const policy = getPolicy(database);
  if (!policy) return JSON.stringify({ ok: false, error: 'POLICY_NOT_FOUND' });

  const client = getClient(invoice.clientId, database);
  if (!client) return JSON.stringify({ ok: false, error: 'CLIENT_NOT_FOUND' });

  // Rebase plan dates if deposit date has passed (D8).
  const proposal: PlanProposal = {
    invoiceId: plan.invoiceId,
    discountPercent: plan.discountPercent,
    installments: plan.installments,
  };
  const rebased = rebasePlan(proposal, now);

  // Re-evaluate after rebase.
  const decision = evaluatePlan(policy, invoice, rebased, now);
  if (!decision.allowed) {
    insertApproval(
      {
        invoiceId: invoice.id,
        planId: plan.id,
        kind: 'PLAN_OUT_OF_BOUNDS' as ApprovalKind,
        reason: `Rebased plan still violates policy: ${decision.violations.map((v) => v.message).join('; ')}`,
        recommendation: 'Create a new plan with updated dates or adjusted terms.',
        status: 'PENDING',
        ownerResponse: null,
        createdAt: now.toISOString(),
        resolvedAt: null,
      },
      database,
    );
    updateInvoice(invoice.id, { chaseState: 'ESCALATED' as ChaseState }, database);
    audit({ actor: 'agent', action: 'create_plan_invoices', invoiceId: invoice.id, input, result: { ok: false, escalated: true, violations: decision.violations }, ok: false }, database);
    emit({ type: 'approval.created', invoiceId: invoice.id, at: now.toISOString() });
    return JSON.stringify({ ok: false, escalated: true, violations: decision.violations });
  }

  const paypal = paypalOverride ?? getPayPal();
  // Sandbox retains old invoice numbers after a reset. Keep retries stable within each plan.
  const sandboxPlanSuffix = getPayPalEnv().mode === 'sandbox'
    ? createHash('sha256').update(plan.id).digest('hex').slice(0, 12)
    : null;
  const createdPayPalIds: string[] = [];

  type LocalInstallment = {
    localId: string;
    paypalId: string;
    paypalUrl: string;
    no: number;
    amountCents: number;
    dueAt: string;
  };

  const installmentInvoices: LocalInstallment[] = [];

  // Create and send one PayPal invoice per installment.
  for (const inst of rebased.installments) {
    const requestId = `${plan.id}-${inst.no}`;
    const suffix = `-P${inst.no}${sandboxPlanSuffix ? `-${sandboxPlanSuffix}` : ''}`;
    try {
      const ppInvoice = await paypal.createInvoice({
        requestId,
        clientName: client.name,
        clientEmail: client.email,
        number: sandboxPlanSuffix ? `${invoice.number.slice(0, 25 - suffix.length)}${suffix}` : `${invoice.number}${suffix}`,
        description: `${invoice.description} — Installment ${inst.no} of ${rebased.installments.length}`,
        amountCents: inst.amountCents,
        dueAt: inst.dueAt,
        note: `Payment plan installment ${inst.no} of ${rebased.installments.length} for invoice ${invoice.number}.`,
      });
      await paypal.sendInvoice(ppInvoice.paypalInvoiceId);
      createdPayPalIds.push(ppInvoice.paypalInvoiceId);
      installmentInvoices.push({
        localId: crypto.randomUUID(),
        paypalId: ppInvoice.paypalInvoiceId,
        paypalUrl: ppInvoice.recipientViewUrl ?? '',
        no: inst.no,
        amountCents: inst.amountCents,
        dueAt: inst.dueAt,
      });
    } catch (err) {
      // Compensate: cancel already-created invoices.
      for (const pid of createdPayPalIds) {
        try { await paypal.cancelInvoice(pid); } catch { /* best-effort */ }
      }
      insertApproval(
        {
          invoiceId: invoice.id,
          planId: plan.id,
          kind: 'PAYPAL_ERROR' as ApprovalKind,
          reason: `PayPal invoice creation failed for installment ${inst.no}: ${err instanceof Error ? err.message : String(err)}`,
          recommendation: 'Retry creating the plan invoices or create them manually in PayPal.',
          status: 'PENDING',
          ownerResponse: null,
          createdAt: now.toISOString(),
          resolvedAt: null,
        },
        database,
      );
      audit({ actor: 'agent', action: 'create_plan_invoices', invoiceId: invoice.id, input, result: { ok: false, paypalError: true, installment: inst.no }, ok: false }, database);
      return JSON.stringify({ ok: false, paypalError: true, installment: inst.no });
    }
  }

  // Cancel original invoice in PayPal (best-effort per D6).
  if (invoice.paypalInvoiceId) {
    try {
      await paypal.cancelInvoice(invoice.paypalInvoiceId);
    } catch (err) {
      insertApproval(
        {
          invoiceId: invoice.id,
          planId: plan.id,
          kind: 'PAYPAL_ERROR' as ApprovalKind,
          reason: `Failed to cancel original PayPal invoice ${invoice.paypalInvoiceId}: ${err instanceof Error ? err.message : String(err)}`,
          recommendation: 'Cancel the original invoice manually in PayPal to avoid duplicate payment.',
          status: 'PENDING',
          ownerResponse: null,
          createdAt: now.toISOString(),
          resolvedAt: null,
        },
        database,
      );
      audit({ actor: 'agent', action: 'cancel_original_invoice', invoiceId: invoice.id, input: { paypalInvoiceId: invoice.paypalInvoiceId }, result: { ok: false, error: err instanceof Error ? err.message : String(err) }, ok: false }, database);
    }
  }

  // Insert local installment invoice rows.
  for (const ii of installmentInvoices) {
    const dueMs = Date.parse(ii.dueAt.length === 10 ? `${ii.dueAt}T00:00:00.000Z` : ii.dueAt);
    const installmentStatus = dueMs < now.getTime() ? ('OVERDUE' as const) : ('SENT' as const);
    database
      .insert(invoicesTable)
      .values({
        id: ii.localId,
        paypalInvoiceId: ii.paypalId,
        paypalInvoiceUrl: ii.paypalUrl,
        clientId: invoice.clientId,
        number: `${invoice.number}-P${ii.no}`,
        description: `${invoice.description} — Installment ${ii.no} of ${installmentInvoices.length}`,
        amountCents: ii.amountCents,
        paidCents: 0,
        currency: 'USD',
        issuedAt: now.toISOString(),
        dueAt: ii.dueAt,
        status: installmentStatus,
        parentInvoiceId: invoice.id,
        planId: plan.id,
        installmentNo: ii.no,
        chaseState: 'NEW',
      })
      .run();
  }

  // Mark original SUPERSEDED, plan ACTIVE.
  updateInvoice(invoice.id, { status: 'SUPERSEDED', chaseState: 'PLAN_ACTIVE' as ChaseState, planId: plan.id }, database);
  updatePlan(plan.id, { status: 'ACTIVE', installments: rebased.installments }, database);

  audit({ actor: 'agent', action: 'create_plan_invoices', invoiceId: invoice.id, input, result: { ok: true, installmentsCreated: installmentInvoices.length }, ok: true }, database);
  emit({ type: 'invoice.updated', invoiceId: invoice.id, at: now.toISOString() });

  return JSON.stringify({ ok: true, installmentsCreated: installmentInvoices.length, planId: plan.id });
}

async function handleEscalateToOwner(
  rawInput: unknown,
  database: AppDb,
  now: Date,
): Promise<string> {
  const parsed = escalateSchema.safeParse(rawInput);
  if (!parsed.success) {
    return JSON.stringify({ ok: false, error: 'VALIDATION_ERROR', details: parsed.error.issues });
  }
  const input = parsed.data;

  const invoice = getInvoice(input.invoiceId, database);
  if (!invoice) return JSON.stringify({ ok: false, error: 'INVOICE_NOT_FOUND' });

  const approval = insertApproval(
    {
      invoiceId: invoice.id,
      planId: null,
      kind: input.kind as ApprovalKind,
      reason: input.reason,
      recommendation: input.recommendation,
      status: 'PENDING',
      ownerResponse: null,
      createdAt: now.toISOString(),
      resolvedAt: null,
    },
    database,
  );

  updateInvoice(invoice.id, { chaseState: 'ESCALATED' as ChaseState }, database);

  audit({ actor: 'agent', action: 'escalate_to_owner', invoiceId: invoice.id, input, result: { ok: true, approvalId: approval.id }, ok: true }, database);
  emit({ type: 'approval.created', invoiceId: invoice.id, at: now.toISOString() });

  return JSON.stringify({ ok: true, approvalId: approval.id });
}

async function handleScheduleFollowup(
  rawInput: unknown,
  database: AppDb,
  now: Date,
): Promise<string> {
  const parsed = scheduleFollowupSchema.safeParse(rawInput);
  if (!parsed.success) {
    return JSON.stringify({ ok: false, error: 'VALIDATION_ERROR', details: parsed.error.issues });
  }
  const input = parsed.data;

  const invoice = getInvoice(input.invoiceId, database);
  if (!invoice) return JSON.stringify({ ok: false, error: 'INVOICE_NOT_FOUND' });

  const followupDate = new Date(now.getTime() + input.inDays * 24 * 60 * 60 * 1000);
  updateInvoice(invoice.id, { nextFollowupAt: followupDate.toISOString() }, database);

  audit({ actor: 'agent', action: 'schedule_followup', invoiceId: invoice.id, input, result: { ok: true, nextFollowupAt: followupDate.toISOString() }, ok: true }, database);
  emit({ type: 'invoice.updated', invoiceId: invoice.id, at: now.toISOString() });

  return JSON.stringify({ ok: true, nextFollowupAt: followupDate.toISOString() });
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export async function handleToolCall(
  name: string,
  rawInput: unknown,
  database: AppDb,
  now: Date,
  paypalOverride?: PayPalClient,
): Promise<string> {
  const before = listAudit(undefined, database).length;
  let output: string;
  try {
    switch (name) {
      case 'get_invoice_context': output = await handleGetInvoiceContext(rawInput, database, now); break;
      case 'send_message': output = await handleSendMessage(rawInput, database, now); break;
      case 'propose_payment_plan': output = await handleProposePaymentPlan(rawInput, database, now); break;
      case 'create_plan_invoices': output = await handleCreatePlanInvoices(rawInput, database, now, paypalOverride); break;
      case 'escalate_to_owner': output = await handleEscalateToOwner(rawInput, database, now); break;
      case 'schedule_followup': output = await handleScheduleFollowup(rawInput, database, now); break;
      default: output = JSON.stringify({ ok: false, error: 'UNKNOWN_TOOL', tool: name });
    }
  } catch (error) {
    output = JSON.stringify({ ok: false, error: 'TOOL_ERROR', message: error instanceof Error ? error.message : 'Tool failed' });
  }
  if (listAudit(undefined, database).length === before) {
    const objectInput = rawInput && typeof rawInput === 'object' ? rawInput as Record<string, unknown> : {};
    const invoiceId = typeof objectInput.invoiceId === 'string' ? objectInput.invoiceId : null;
    let result: unknown;
    try { result = JSON.parse(output) as unknown; } catch { result = output; }
    const ok = !!result && typeof result === 'object' && (result as { ok?: unknown }).ok === true;
    audit({ actor: 'agent', action: name, invoiceId: invoiceId ?? undefined, input: rawInput, result, ok }, database, now.toISOString());
  }
  return output;
}
