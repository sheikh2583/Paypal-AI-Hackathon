// Shared contracts. Mirrors docs/04-contracts.md exactly — if you change one,
// change the other in the same PR.

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export type Cents = number; // integer

export type InvoiceStatus =
  | 'SENT' | 'OVERDUE' | 'PARTIALLY_PAID' | 'PAID' | 'CANCELLED' | 'SUPERSEDED';

export type ChaseState =
  | 'NEW' | 'NUDGED' | 'NEGOTIATING' | 'PLAN_OFFERED' | 'PLAN_ACCEPTED'
  | 'PLAN_ACTIVE' | 'ESCALATED' | 'RESOLVED';

export interface OwnerPolicy {
  minDepositPercent: number;     // 0-100
  maxInstallments: number;       // includes deposit
  maxPlanDays: number;           // last due date within N days of acceptance
  maxDiscountPercent: number;    // 0-100
  autoApproveBelowCents: Cents;  // plan totals below this need no owner sign-off
  tone: 'friendly' | 'firm';
  businessName: string;
  ownerName: string;
}

export interface Installment { no: number; amountCents: Cents; dueAt: string } // ISO

export interface PlanProposal {
  invoiceId: string;
  discountPercent: number;
  installments: Installment[];
}

export interface PolicyViolation {
  code:
    | 'DEPOSIT_TOO_LOW' | 'TOO_MANY_INSTALLMENTS' | 'PLAN_TOO_LONG'
    | 'DISCOUNT_TOO_HIGH' | 'TOTAL_MISMATCH' | 'INSTALLMENT_NOT_POSITIVE'
    | 'DUE_DATE_IN_PAST' | 'INVOICE_NOT_ELIGIBLE' | 'PLAN_TOO_SMALL';
  message: string; // human-readable, safe to show the LLM and the owner
}

export interface PolicyDecision {
  allowed: boolean;
  needsOwnerApproval: boolean;  // allowed by bounds but above autoApproveBelowCents
  violations: PolicyViolation[];
}

export interface RiskResult {
  score: number;  // 0-100, higher = riskier
  factors: { factor: string; impact: number }[]; // impact in points, may be negative
}

export interface ChatMessage {
  id: string;
  invoiceId: string;
  direction: 'agent_to_client' | 'client_to_agent' | 'system' | 'owner_note';
  body: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Additional types
// Row types mirror docs/03-data-model.md in camelCase. All money is Cents;
// all timestamps are ISO strings.
// ---------------------------------------------------------------------------

export type PlanStatus =
  | 'OFFERED' | 'ACCEPTED' | 'ACTIVE' | 'REJECTED' | 'EXPIRED' | 'PENDING_APPROVAL';

export type ApprovalKind =
  | 'PLAN_OUT_OF_BOUNDS' | 'PLAN_NEEDS_SIGNOFF' | 'DISCOUNT_REQUEST' | 'DISPUTE'
  | 'UNCLEAR' | 'ABUSE' | 'UNEXPECTED_PAYMENT' | 'PAYPAL_ERROR';

export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'EDITED';

// What an agent run ends as. NO_ACTION leaves chase_state unchanged.
export type RunOutcome =
  | 'NUDGED' | 'PLAN_OFFERED' | 'PLAN_ACTIVE' | 'ESCALATED' | 'WAITING' | 'NO_ACTION';

export interface ClientRow {
  id: string; name: string; email: string; persona: string | null;
  lateCount: number; avgDaysLate: number;
  responsiveness: 'high' | 'medium' | 'low'; notes: string | null;
}

export interface InvoiceRow {
  id: string; paypalInvoiceId: string | null; paypalInvoiceUrl: string | null;
  clientId: string; number: string; description: string;
  amountCents: Cents; paidCents: Cents; currency: 'USD';
  issuedAt: string; dueAt: string; status: InvoiceStatus;
  parentInvoiceId: string | null; planId: string | null; installmentNo: number | null;
  chaseState: ChaseState;
  riskScore: number | null; riskFactors: RiskResult['factors'];
  riskExplanation: string | null;
  lastAgentRunAt: string | null; nextFollowupAt: string | null;
}

export interface PlanRow {
  id: string; invoiceId: string; status: PlanStatus;
  discountPercent: number; totalCents: Cents; installments: Installment[];
  createdBy: 'agent' | 'owner'; approvedBy: 'policy' | 'owner' | null; createdAt: string;
}

export interface ApprovalRow {
  id: string; invoiceId: string; planId: string | null; kind: ApprovalKind;
  reason: string; recommendation: string; status: ApprovalStatus;
  ownerResponse: string | null; createdAt: string; resolvedAt: string | null;
}

export interface AuditEntry {
  id: string; at: string; actor: 'agent' | 'owner' | 'system' | 'paypal';
  action: string; invoiceId: string | null;
  input: unknown; result: unknown; ok: boolean; // redacted
}

export interface InvoiceListItem {
  invoice: InvoiceRow; client: ClientRow;
  daysOverdue: number; riskLabel: 'Low' | 'Medium' | 'High';
  nextAction: string;          // from nextAction(), human-readable
  pendingApprovalId: string | null;
}

export interface ReplyClassification {
  intent: 'will_pay_full' | 'cannot_pay_full' | 'accepts_plan' | 'rejects_plan'
        | 'asks_discount' | 'disputes' | 'asks_extension' | 'abusive' | 'unclear' | 'other';
  requestedDiscountPercent?: number;
  proposedInstallments?: number;
  confidence: number; // 0-1
}

export interface ToolCallRecord {
  tool: string; input: unknown; ok: boolean; result: unknown; at: string;
}

export interface AgentRunResult {
  runId: string; finalState: RunOutcome; summary: string; toolCalls: ToolCallRecord[];
}

// ---------------------------------------------------------------------------
// PayPal client (src/lib/paypal)
// ---------------------------------------------------------------------------

export interface PayPalClient {
  createInvoice(input: CreateInvoiceInput): Promise<PayPalInvoice>;
  sendInvoice(paypalInvoiceId: string): Promise<void>;
  getInvoice(paypalInvoiceId: string): Promise<PayPalInvoice>;
  cancelInvoice(paypalInvoiceId: string): Promise<void>;
  // mock-only helpers (no-ops or throws in real mode)
  simulatePayment?(paypalInvoiceId: string, amountCents?: Cents): Promise<void>;
}

export interface CreateInvoiceInput {
  requestId: string;            // idempotency key -> PayPal-Request-Id
  clientName: string;
  clientEmail: string;
  number: string;               // invoice number
  description: string;
  amountCents: Cents;
  dueAt: string;                // ISO date
  note?: string;
}

export interface PayPalInvoice {
  paypalInvoiceId: string;
  number: string;
  status: 'DRAFT' | 'SENT' | 'PAID' | 'PARTIALLY_PAID' | 'CANCELLED' | 'UNKNOWN';
  amountCents: Cents;
  paidCents: Cents;
  recipientViewUrl?: string;
}
