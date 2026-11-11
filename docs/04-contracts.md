# 04 — Contracts

These are the interfaces three people build against in parallel. They mirror `src/lib/types.ts`. **If you change one, update this file and tell the team.**

The server uses `DATABASE_PATH` for local SQLite. Set both `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` to use hosted SQLite for application data and Better Auth. Supplying just one setting is an error.

## Shared types (`src/lib/types.ts`)

```ts
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
  updatedAt?: string;            // ISO UTC; metadata set by the DB layer, not a policy rule
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
```

## Additional types (`src/lib/types.ts`)

Row types mirror `docs/03-data-model.md` in camelCase. All money is `Cents`; all timestamps are ISO strings.

```ts
export type PlanStatus =
  | 'OFFERED' | 'ACCEPTED' | 'ACTIVE' | 'RESOLVED' | 'REJECTED' | 'EXPIRED' | 'PENDING_APPROVAL';

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
```

## Policy engine (`src/lib/policy`) — Person B

```ts
evaluatePlan(policy: OwnerPolicy, invoice: InvoiceRow, proposal: PlanProposal, now: Date): PolicyDecision
suggestPlan(policy: OwnerPolicy, invoice: InvoiceRow, installments: number, now: Date): PlanProposal // minimum compliant deposit; count clamped to [2, maxInstallments]
rebasePlan(proposal: PlanProposal, now: Date): PlanProposal // shifts all due dates forward (keeping spacing) if the deposit date has passed
```
Rules (all must hold, pure functions, fully unit-tested):
1. `discountPercent <= maxDiscountPercent`
2. `installments.length <= maxInstallments`
3. first installment `>= ceil(discountedTotal * minDepositPercent / 100)`, where `discountedTotal = floor((remaining * (100 - discount) + 50) / 100)` (integer math, round half up); `remaining = amountCents - paidCents`
4. every `dueAt <= now + maxPlanDays`
5. all amounts are positive integers and all due dates are valid ISO dates on or after today. Installments submitted through the agent tool are numbered consecutively starting at 1.
6. sum of installments == `discountedTotal` exactly; non-deposit installments are `floor((discountedTotal - deposit) / (n - 1))` and the rounding remainder goes on the **last** installment
7. invoice status must be `OVERDUE` with `paidCents == 0` (partially paid invoices are escalated, not planned, in the MVP), and `remaining >= MIN_PLAN_REMAINING_CENTS` (10000, a constant in the policy module; otherwise `PLAN_TOO_SMALL`)
8. `needsOwnerApproval = total >= autoApproveBelowCents`

Date semantics: rules 4 and 5 are evaluated against the `now` passed in. `suggestPlan` dates: deposit at `now + 3 days`, then every 30 days, each clamped to `now + maxPlanDays`. At `create_plan_invoices` time call `rebasePlan(plan, now)` before `evaluatePlan`; if it still fails (e.g. `PLAN_TOO_LONG`), escalate as `PLAN_OUT_OF_BOUNDS` instead of creating invoices.

## PayPal client (`src/lib/paypal`) — Person A

```ts
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
```

## Agent tools (`src/lib/agent/tools.ts`) — Person B

Each tool: Zod-validated input → policy where needed → effect → audit → JSON result.

| tool | input | effect |
|---|---|---|
| `get_invoice_context` | `{invoiceId}` | read-only: invoice, client history, risk, last 20 messages, policy summary |
| `send_message` | `{invoiceId, body}` | Stores a nonblank `agent_to_client` message up to 900 characters. Only the recipient URLs of this invoice and its plan are allowed. Known coercive phrases and disclosures of internal instructions or limits are rejected and audited. |
| `propose_payment_plan` | `{invoiceId, discountPercent, installments[]}` | policy check. Allowed and under the auto-approve threshold: creates plan `OFFERED`. Allowed but `needsOwnerApproval`: creates plan `PENDING_APPROVAL` + approval `PLAN_NEEDS_SIGNOFF`, sets `chase_state=ESCALATED`; the client sees no terms until the owner approves. Denied: returns violations, creates nothing |
| `create_plan_invoices` | `{planId}` | only if plan `ACCEPTED`; `rebasePlan` + policy re-check; creates and sends all installment invoices (cancels any already created if one fails), then cancels the original in PayPal and marks it `SUPERSEDED`; plan `ACTIVE`, `chase_state=PLAN_ACTIVE`; idempotent |
| `escalate_to_owner` | `{invoiceId, kind, reason, recommendation}` | creates `approvals` row; sets `chase_state=ESCALATED` |
| `schedule_followup` | `{invoiceId, inDays}` | sets `invoices.next_followup_at = now + inDays` (1–14); no message sent |

Not tools (the LLM cannot do these): changing policy, marking an invoice paid, cancelling invoices, accepting a plan on the client's behalf. Plan acceptance is recorded by the client-reply handler when the client's message clearly accepts (the LLM classifies via a `classify_client_reply` structured output, validated by Zod).

## HTTP API (route handlers) — Person C consumes, A/B implement

All owner pages, mock invoice pages, and mutation APIs require a verified single-owner Better Auth session with email OTP, except the auth endpoints and PayPal webhooks. Initial account creation is allowed only once, for `AUTH_OWNER_EMAIL`; no public demo credentials are shipped.

| method + path | body | returns |
|---|---|---|
| `GET/POST /api/auth/[...all]` | Better Auth payloads | Email/password sign-up and sign-in, email verification, OTP challenge, password reset, session and sign-out endpoints; setup gate permits only the first configured owner |
| `GET /api/invoices` | – | `InvoiceListItem[]` with a 5-second reconciliation throttle. Client email is redacted in public demo mode. |
| `GET /api/invoices/:id` | – | invoice + messages + plan + approvals |
| `POST /api/agent/run` | `{invoiceId}` | `AgentRunResult` |
| `POST /api/agent/run-due` | – | runs the agent for every invoice whose `next_followup_at <= now`; returns `AgentRunResult[]` |
| `POST /api/mock-paypal/pay` | `{paypalInvoiceId}` | mock mode only: `simulatePayment` then `reconcilePayPalInvoices()` |
| `POST /api/sim/client-reply` | `{invoiceId, text?}` | stored client `ChatMessage`; triggers agent run unless `?norun=1` |
| `GET /api/approvals` | – | pending + resolved approvals |
| `POST /api/approvals/:id` | `{decision:'APPROVED'\|'REJECTED'\|'EDITED', note?, plan?}` | updated approval |
| `GET/PUT /api/policy` | `OwnerPolicy` | `OwnerPolicy` |
| `GET /api/audit?invoiceId=` | – | `AuditEntry[]` newest first |
| `POST /api/webhooks/paypal` | PayPal event, signed in Sandbox or `X-Chaser-Mock-Webhook: 1` in mock | `200 {received: true}` after recording the event ID. Invalid signatures return `400`, verification outages return `503`, and unsupported methods such as GET return `405`. No owner session required. |
| `GET /api/events` | – | `text/event-stream` with JSON `data:` frames of `{type, invoiceId?, at}`, a comment heartbeat every 15 s, and browser reconnect. `paypal.webhook.processed` refreshes stored webhook evidence even when the invoice had already been reconciled. Requires workspace access. |
| `POST /api/demo/step` | `{invoiceId, action?: 'priya-counter'}` | Advances the guided Dana flow or simulates Priya’s discount request. An already active Dana plan returns `{done: true, message}` with payment instructions for the configured PayPal mode. The demo-only counter requires Priya’s pending approval and a 5% discount within policy. |
| `POST /api/demo/reset` | `{}` | Reseeds fictional business data and resets the demo clock. Public mode supports Turso and Sandbox, preserves auth, and attempts to cancel unpaid app-issued installments after responding. Private reset requires local SQLite and mock mode. |
| `POST /api/demo/simulate-payment` | `{invoiceId, amountCents?}` | Local invoice ID. Mock applies the payment and reconciles. Sandbox reconciles and returns `409` with instructions to pay on PayPal. |
| `POST /api/demo/advance-time` | `{days}` | Adds 1–365 whole days to the demo clock, recomputes overdue status, and refreshes risk on open invoices. Returns `{now, overdueUpdated, refreshed, message}`. |

Demo routes return `404` in production unless `DEMO_PUBLIC=1`. Enabled routes use the workspace access gate, which permits guests in public mode. Public demo mutations are rate-limited per process and return `429` with `Retry-After` if busy or cooling down. In an active plan, paid installment count and the next due installment come from the invoice rows. When all installments are paid, the plan and the original invoice's chase state become `RESOLVED`. The original payment status stays `SUPERSEDED` so installment amounts are counted once.

Error shape for all routes: `{ error: { code: string, message: string } }` with an appropriate HTTP status.

## Client reliability read model

`/clients` and the invoice badge share the server-side `ClientReliability` view. Inputs are the client ID and name, invoice or installment ID, client ID, due date, status and integer cents, and linked `payment_observed` or `discount_escalation` events. Results include score, grade, rank, outstanding cents, average days late and a named four-component breakdown with points, weight and explanation. Null score, grade and rank denote an unranked client. A null component means that its input is unavailable. The view exposes no new API and uses the same workspace access gate as the other owner pages. See D64 for the calculation.
