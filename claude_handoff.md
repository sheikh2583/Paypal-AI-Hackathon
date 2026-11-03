# 🤝 Chaser — Claude Handoff

> Paste this entire document into Claude.ai to bring a new Claude session fully up to speed on the Chaser project.

---

## What is Chaser?

**Chaser** is an AI collections agent for freelancers and micro-businesses, built for the **PayPal AI Hackathon 2026** ("Build What's Next with PayPal and AI"). It:

- Watches overdue PayPal invoices
- Triages them by risk score
- Writes follow-up messages to clients
- Negotiates payment plans **within owner-set bounds**
- Issues installment invoices through PayPal
- Tracks payment progress
- Escalates anything out-of-bounds to a human approval inbox

**GitHub repo:** https://github.com/sheikh2583/Paypal-AI-Hackathon  
**Live deployment:** https://paypal-ai-hackathon-9tkr.onrender.com (Render free tier, mock PayPal mode)  
**Hackathon deadline:** Nov 12, 2026 (Devpost)  
**Target awards:** Best Use of Agentic Commerce · Most Impactful · Best Use of PayPal + AI · Best Demo Delivery

---

## Stack

| Layer | Tech |
|---|---|
| Framework | Next.js 16.4.3 (App Router, Turbopack) + TypeScript strict |
| UI | Tailwind CSS 4 + shadcn/ui (configured by hand, no components installed yet — see D19) |
| Database | SQLite via `better-sqlite3` 13.0.3 + Drizzle ORM 0.45.4 (file at `./data/chaser.db`) |
| Validation | Zod 4.6.7 (v4 API — use `z.string()` not `z.string().min(1)` for nonempty etc.) |
| Tests | Vitest 5.0.5 |
| LLM | Anthropic SDK or plain-fetch OpenAI-compatible chat completions behind `src/lib/llm.ts`. Configure compatible providers with `LLM_PROVIDER`, `LLM_BASE_URL`, `LLM_API_KEY`, and `LLM_MODEL`; `LLM_MODE=auto` uses scripted mode when the selected provider has no key |
| PayPal | Direct REST fetch from `src/lib/paypal/`. `PAYPAL_MODE=mock` = fully fake. `PAYPAL_MODE=sandbox` = real Sandbox API |
| Package manager | `pnpm` 10.28.0 |
| Node | 22.23.4 |
| Deployment | Render (free tier). Config in `render.yaml`. Build: `npx pnpm install && pnpm build`. Start: `pnpm db:push; pnpm db:seed; pnpm start` |

---

## Commands

```bash
pnpm dev           # dev server on :3000
pnpm build         # production build
pnpm lint
pnpm typecheck     # tsc --noEmit
pnpm test          # vitest run (includes scripted evals)
pnpm test:evals    # eval CLI; add --live for real LLM
pnpm db:push       # apply schema (idempotent; ignore "index already exists" warning)
pnpm db:seed       # reset + reseed demo data
pnpm paypal:smoke  # smoke test PayPal client in current PAYPAL_MODE
```

**Before declaring any task done:** `pnpm typecheck && pnpm lint && pnpm test` must all pass.

---

## Current State (as of Nov 3 2026 — prompt 04 complete)

### ✅ What exists and works

**Foundation (complete, 226 passing tests + 1 skipped):**
- Full DB schema (Drizzle + SQLite) — all 10 tables: `owner_policy`, `clients`, `invoices`, `plans`, `messages`, `approvals`, `audit_log`, `webhook_events`, `mock_paypal_invoices`, `kv`
- Full `queries.ts` — all read/write helpers including `updateInvoice`, `insertMockPaypalInvoice`, `getMockPaypalInvoice`, `updateMockPaypalInvoice`, `listReconcilableInvoices`
- Seed script with 5 demo clients/invoices (Elena $2,400 · Priya $1,800 · Marcus $960 · Olivia $1,250 · Noah $540 — all overdue)
- `src/lib/types.ts`, `env.ts`, `clock.ts`, `money.ts`, `audit.ts`, `events.ts`
- `vitest.config.mts`, `tsconfig.json`, `next.config.ts`, `drizzle.config.ts`, `tailwind.config.ts` all configured
- `.env.example`, `render.yaml` (live at https://paypal-ai-hackathon-9tkr.onrender.com)

**PayPal integration (complete, prompt 03):**
- `src/lib/paypal/map.ts` — type mapping, `buildCreateInvoiceBody`, `mapGetResponseToInvoice`, `mapPayPalStatus`, money conversions (reuses money.ts)
- `src/lib/paypal/auth.ts` — OAuth2 client-credentials with in-memory token cache (refresh 60s early); never logs secrets
- `src/lib/paypal/real.ts` — `RealPayPalClient`: 10s timeout, `PayPal-Request-Id` header, 2-retry on 5xx, typed `PayPalError`. **UNVERIFIED** (D32/D35)
- `src/lib/paypal/mock.ts` — `MockPayPalClient` backed by `mock_paypal_invoices` table. IDs: `MOCK-INV2-<8hex>`. `simulatePayment` → PAID/PARTIALLY_PAID + `invoice.paid` event
- `src/lib/paypal/reconcile.ts` — `reconcilePayPalInvoices()`: idempotent status sync, `UNEXPECTED_PAYMENT` approval on superseded invoices (D37)
- `src/lib/paypal/simulate-payment.ts` — `simulateMockPayment()` and `simulateMockPaymentByLocalId()` — shared between route handlers (D2)
- `src/lib/paypal/index.ts` — `getPayPal()` factory
- `src/lib/paypal/smoke.ts` — `pnpm paypal:smoke` end-to-end test
- `src/app/mock-paypal/invoice/[id]/page.tsx` — functional mock invoice page with MOCK badge, amount, status, pay button
- `src/app/mock-paypal/invoice/[id]/mock-pay-now-button.tsx` — client component
- `src/app/api/mock-paypal/pay/route.ts` — mock-mode-only route (409 in real mode), Zod-validated
- **Tests:** 32 map tests + 9 mock lifecycle/reconcile tests + 1 skipped contract test

**Policy + Risk modules (complete, prompt 04):**
- `src/lib/policy/plan.ts` — `evaluatePlan`, `suggestPlan`, `rebasePlan`, `remainingCents`, `discountedTotal`, `minDeposit`, `MIN_PLAN_REMAINING_CENTS`
- `src/lib/policy/index.ts` — re-exports
- `src/lib/risk/index.ts` — `computeRisk(features)`, `riskLabel(score)`, `RiskFeatures` interface
- **Tests:** 65 policy tests + 51 risk tests

**Schema + Seed aligned with docs (complete, prompt 05):**
- `src/lib/db/schema.ts` — added `owner_policy.updated_at`, `webhook_events.processed_at`, fixed composite index `(status, due_at)`, removed incorrect UNIQUE on `clients.email`
- `src/lib/db/seed.ts` — fully rewritten to match docs/07: Maya Rahman owner, 5 correct clients/invoices ($5,500 total), correct policy values
- `src/lib/db/test-utils.ts` — updated to match schema
- **Tests:** 9 seed tests (contract test verifying docs/07 table row-by-row)

**Shared components:** `app-nav.tsx`, `page-header.tsx`, `empty-state.tsx`
**Placeholder pages:** `/`, `/invoices/[id]`, `/approvals`, `/policy`, `/audit`

### 🚧 Not yet built

- `src/lib/agent/` — LLM tool-use loop, tools, prompt, classifier, scripts, next-action
- `src/lib/llm.ts` — LLM wrapper
- `src/lib/approvals/service.ts` — owner decision handling
- `src/lib/sim/client.ts` — simulated client personas
- `src/lib/client-api.ts` — typed fetch helpers for UI
- API routes: `agent/run`, `agent/run-due`, `sim/client-reply`, `approvals/[id]`, `policy`, `webhooks/paypal`, `demo/{reset,simulate-payment,advance-time}`, `events`
- All real UI pages (dashboard, invoice detail, approvals, policy, audit)
- `src/evals/` — eval scenarios

---

## Architecture

```
┌──────────────────────────── Browser (owner) ───────────────────────────┐
│  Dashboard · Invoice detail + chat · Approvals · Policy · Audit log     │
└───────────────┬─────────────────────────────────────────────────────────┘
                │ fetch / SSE (or polling)
┌───────────────▼──────────── Next.js route handlers ────────────────────┐
│ /api/agent/run  /api/sim/client-reply  /api/approvals/*  /api/policy   │
│ /api/webhooks/paypal  /api/demo/*  /api/events (SSE)                   │
└───────┬──────────────┬───────────────┬───────────────┬─────────────────┘
        │              │               │               │
   lib/agent      lib/policy      lib/paypal        lib/db (Drizzle)
 (LLM tool loop)  (allow/deny)  (real | mock)       SQLite
        │              ▲               ▲
        └── tools ─────┘───────────────┘
        lib/llm.ts (Anthropic SDK; scripted mode)
```

**Key design principle:** Agent proposes, policy disposes. Every money-affecting action goes through `src/lib/policy/` (pure functions, fully unit-tested). The LLM can propose; the policy engine decides. This is non-negotiable.

---

## File Layout

```
src/
  app/
    (app)/
      page.tsx                    # dashboard
      invoices/[id]/page.tsx      # invoice detail + conversation + sim client
      approvals/page.tsx
      policy/page.tsx
      audit/page.tsx
      layout.tsx
    mock-paypal/invoice/[id]/page.tsx   # fake PayPal invoice page (mock mode)
    api/
      invoices/route.ts, invoices/[id]/route.ts    # read-only, thin
      approvals/route.ts                           # list, thin
      audit/route.ts                               # thin
      mock-paypal/pay/route.ts                     # mock payment
      agent/run/route.ts
      agent/run-due/route.ts
      sim/client-reply/route.ts
      approvals/[id]/route.ts
      policy/route.ts
      webhooks/paypal/route.ts
      demo/{reset,simulate-payment,advance-time}/route.ts
      events/route.ts
  components/
    app-nav.tsx
    page-header.tsx
    empty-state.tsx
    ui/                           # shadcn/ui components (none installed yet)
  lib/
    types.ts                      # ALL shared contracts (source of truth)
    env.ts                        # Zod env validation
    clock.ts                      # getNow() — use this everywhere, never new Date()
    money.ts                      # cents helpers
    audit.ts
    events.ts                     # event bus
    llm.ts                        # Anthropic wrapper (stub)
    utils.ts                      # cn() etc
    db/
      schema.ts                   # ✅ complete — all 10 tables
      client.ts                   # ✅ Drizzle client
      queries.ts                  # ✅ complete — all read/write helpers
      seed.ts                     # ✅ demo data
      test-utils.ts               # ✅ in-memory test DB helper
    paypal/{index.ts,real.ts,mock.ts,auth.ts,map.ts,reconcile.ts}  # ✅ complete
    policy/{index.ts,plan.ts}                                        # ✅ complete (65 tests)
    risk/{index.ts}                                                  # ✅ complete (51 tests)
    agent/{run.ts,tools.ts,prompt.ts,classify.ts,scripts.ts,next-action.ts} # 🚧
    approvals/service.ts                                             # 🚧
    sim/client.ts                                                    # 🚧
    client-api.ts                                                    # 🚧
  evals/{scenarios.ts,run.ts,evals.test.ts}                         # 🚧
data/                             # SQLite file (gitignored)
docs/
  01-product-brief.md
  02-architecture.md
  03-data-model.md
  04-contracts.md
  05-paypal-integration.md
  06-agent-design.md
  07-demo-and-submission.md
  08-team-and-timeline.md
  DECISIONS.md
render.yaml                       # Render deployment config
```

---

## DB Schema (actual tables in schema.ts)

The schema uses Drizzle + SQLite. Key notes vs the original design doc:

| Table | Notes |
|---|---|
| `owner_policy` | Single row (`id = "default"`). Replaces `config` table. |
| `clients` | As designed. |
| `invoices` | `risk_factors` stored as JSON text in `riskFactorsJson` column. |
| `plans` | `installments` stored as JSON text in `installmentsJson` column. |
| `messages` | Replaces `chat_messages`. Same columns. |
| `approvals` | As designed. |
| `audit_log` | `input`/`result` stored as JSON text in `inputJson`/`resultJson`. |
| `webhook_events` | Stores raw PayPal webhook payloads (idempotency key = PayPal event id). |
| `mock_paypal_invoices` | Fake PayPal invoice records for `PAYPAL_MODE=mock`. |
| `kv` | Generic key-value store (used for clock offset in time-travel demo). |

All queries live in `src/lib/db/queries.ts`. Use those functions — don't write raw SQL or access the schema directly from outside `src/lib/db/`.

---

## Shared Types (src/lib/types.ts)

```ts
export type Cents = number; // ALWAYS integer cents — never floats for money

export type InvoiceStatus =
  | 'SENT' | 'OVERDUE' | 'PARTIALLY_PAID' | 'PAID' | 'CANCELLED' | 'SUPERSEDED';

export type ChaseState =
  | 'NEW' | 'NUDGED' | 'NEGOTIATING' | 'PLAN_OFFERED' | 'PLAN_ACCEPTED'
  | 'PLAN_ACTIVE' | 'ESCALATED' | 'RESOLVED';

export type PlanStatus =
  | 'OFFERED' | 'ACCEPTED' | 'ACTIVE' | 'REJECTED' | 'EXPIRED' | 'PENDING_APPROVAL';

export type ApprovalKind =
  | 'PLAN_OUT_OF_BOUNDS' | 'PLAN_NEEDS_SIGNOFF' | 'DISCOUNT_REQUEST' | 'DISPUTE'
  | 'UNCLEAR' | 'ABUSE' | 'UNEXPECTED_PAYMENT' | 'PAYPAL_ERROR';

export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'EDITED';

export type RunOutcome =
  | 'NUDGED' | 'PLAN_OFFERED' | 'PLAN_ACTIVE' | 'ESCALATED' | 'WAITING' | 'NO_ACTION';

export interface OwnerPolicy {
  minDepositPercent: number;      // 0-100
  maxInstallments: number;        // includes deposit
  maxPlanDays: number;            // last due date within N days of acceptance
  maxDiscountPercent: number;     // 0-100
  autoApproveBelowCents: Cents;   // plan totals below this need no owner sign-off
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
  message: string;
}

export interface PolicyDecision {
  allowed: boolean;
  needsOwnerApproval: boolean;
  violations: PolicyViolation[];
}

export interface RiskResult {
  score: number;  // 0-100, higher = riskier
  factors: { factor: string; impact: number }[];
}

export interface ChatMessage {
  id: string; invoiceId: string;
  direction: 'agent_to_client' | 'client_to_agent' | 'system' | 'owner_note';
  body: string; createdAt: string;
}

// Row types (camelCase of DB columns)
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
  input: unknown; result: unknown; ok: boolean;
}

export interface InvoiceListItem {
  invoice: InvoiceRow; client: ClientRow;
  daysOverdue: number; riskLabel: 'Low' | 'Medium' | 'High';
  nextAction: string;
  pendingApprovalId: string | null;
}

export interface ReplyClassification {
  intent: 'will_pay_full' | 'cannot_pay_full' | 'accepts_plan' | 'rejects_plan'
        | 'asks_discount' | 'disputes' | 'asks_extension' | 'abusive' | 'unclear' | 'other';
  requestedDiscountPercent?: number;
  proposedInstallments?: number;
  confidence: number; // 0-1
}

export interface AgentRunResult {
  runId: string; finalState: RunOutcome; summary: string; toolCalls: ToolCallRecord[];
}

export interface ToolCallRecord {
  tool: string; input: unknown; ok: boolean; result: unknown; at: string;
}

// PayPal interfaces
export interface PayPalClient {
  createInvoice(input: CreateInvoiceInput): Promise<PayPalInvoice>;
  sendInvoice(paypalInvoiceId: string): Promise<void>;
  getInvoice(paypalInvoiceId: string): Promise<PayPalInvoice>;
  cancelInvoice(paypalInvoiceId: string): Promise<void>;
  simulatePayment?(paypalInvoiceId: string, amountCents?: Cents): Promise<void>;
}

export interface CreateInvoiceInput {
  requestId: string;
  clientName: string; clientEmail: string;
  number: string; description: string;
  amountCents: Cents; dueAt: string; note?: string;
}

export interface PayPalInvoice {
  paypalInvoiceId: string; number: string;
  status: 'DRAFT' | 'SENT' | 'PAID' | 'PARTIALLY_PAID' | 'CANCELLED' | 'UNKNOWN';
  amountCents: Cents; paidCents: Cents;
  recipientViewUrl?: string;
}
```

---

## DB Queries API (src/lib/db/queries.ts)

All implemented and tested. Use these — don't reach into the schema directly.

```ts
// Invoices
listInvoices(db?): InvoiceWithClient[]           // joins client row
getInvoice(id, db?): InvoiceRow | undefined

// Messages
getMessages(invoiceId, db?): ChatMessage[]
insertMessage(message, db?): ChatMessage

// Policy
getPolicy(db?): OwnerPolicy | undefined
upsertPolicy(policy, db?): OwnerPolicy

// Approvals
listApprovals(status?, db?): ApprovalRow[]
insertApproval(input, db?): ApprovalRow
resolveApproval(id, status, ownerResponse, resolvedAt?, db?): ApprovalRow | undefined

// Audit
insertAudit(input, db?): AuditEntry
listAudit(invoiceId?, db?): AuditEntry[]

// Plans
getPlan(id, db?): PlanRow | undefined
insertPlan(plan, db?): PlanRow
updatePlan(id, update, db?): PlanRow | undefined

// Webhooks (idempotency)
upsertWebhookEvent(event, db?): boolean   // returns false if already seen

// KV (clock offset etc.)
getKv(key, db?): string | undefined
setKv(key, value, db?): void
```

All query functions accept an optional `database` param for testing (use `createTestDb()` from `test-utils.ts`).

---

## Policy Engine Rules (src/lib/policy/)

Pure functions, fully unit-tested. **Never weaken these for demo convenience.**

```ts
evaluatePlan(policy, invoice, proposal, now): PolicyDecision
suggestPlan(policy, invoice, installments, now): PlanProposal
rebasePlan(proposal, now): PlanProposal
```

**Math (exact — use integer arithmetic only):**
- `discountedTotal = floor((remaining × (100 − discount) + 50) / 100)`  (round half up)
- `minDeposit = ceil(discountedTotal × minDepositPercent / 100)`
- Remaining installments = `floor((discountedTotal − deposit) / (n − 1))`; rounding remainder on **last** installment
- `suggestPlan`: deposit due `now + 3 days`, subsequent every 30 days, clamped to `now + maxPlanDays`
- `MIN_PLAN_REMAINING_CENTS = 10000` → `PLAN_TOO_SMALL` if below

**Violation codes:** `DEPOSIT_TOO_LOW` · `TOO_MANY_INSTALLMENTS` · `PLAN_TOO_LONG` · `DISCOUNT_TOO_HIGH` · `TOTAL_MISMATCH` · `INSTALLMENT_NOT_POSITIVE` · `DUE_DATE_IN_PAST` · `INVOICE_NOT_ELIGIBLE` · `PLAN_TOO_SMALL`

---

## Agent Tools (src/lib/agent/tools.ts)

Each tool: Zod-validated input → policy check (where money involved) → effect → audit → JSON result.

| Tool | Input | Effect |
|---|---|---|
| `get_invoice_context` | `{invoiceId}` | Read-only: invoice, client history, risk, last 20 messages, policy summary |
| `send_message` | `{invoiceId, body}` | Stores `agent_to_client` message. Max 900 chars. Only allowed URLs: this invoice's PayPal link + same-plan invoices |
| `propose_payment_plan` | `{invoiceId, discountPercent, installments[]}` | Policy check. If allowed + under threshold → `OFFERED`. If allowed + above threshold → `PENDING_APPROVAL` + `PLAN_NEEDS_SIGNOFF` approval, `chase_state=ESCALATED`. If denied → returns violations |
| `create_plan_invoices` | `{planId}` | Only if plan `ACCEPTED`. Rebases + policy recheck. Creates+sends all installment invoices, cancels original. Idempotent |
| `escalate_to_owner` | `{invoiceId, kind, reason, recommendation}` | Creates approval row, sets `chase_state=ESCALATED` |
| `schedule_followup` | `{invoiceId, inDays}` | Sets `next_followup_at = now + inDays` (1–14 range) |

**Limits:** Max 6 tool iterations per run. Hard timeout. Max 1 invoice batch per plan per run.

---

## HTTP API

| Method + Path | Body | Returns |
|---|---|---|
| `GET /api/invoices` | – | `InvoiceListItem[]` |
| `GET /api/invoices/:id` | – | invoice + messages + plan + approvals |
| `POST /api/agent/run` | `{invoiceId}` | `AgentRunResult` |
| `POST /api/agent/run-due` | – | `AgentRunResult[]` for all due invoices |
| `POST /api/mock-paypal/pay` | `{paypalInvoiceId}` | mock only: simulate payment |
| `POST /api/sim/client-reply` | `{invoiceId, text?}` | stored client message + triggers agent run |
| `GET /api/approvals` | – | pending + resolved approvals |
| `POST /api/approvals/:id` | `{decision, note?, plan?}` | updated approval |
| `GET/PUT /api/policy` | `OwnerPolicy` | `OwnerPolicy` |
| `GET /api/audit?invoiceId=` | – | `AuditEntry[]` newest first |
| `POST /api/webhooks/paypal` | PayPal event | `200` fast, idempotent |
| `POST /api/demo/step` | `{invoiceId}` | advance one scripted Dana step; derives step from persisted conversation and plan |
| `POST /api/demo/reset` | – | reseeds fictional demo data and clears demo activity |
| `POST /api/mock-paypal/pay` | `{paypalInvoiceId}` | simulate a payment for a mock PayPal invoice |
| `GET /api/events` | – | SSE stream `{type, invoiceId, at}` |

**Error shape:** `{ error: { code: string, message: string } }` with appropriate HTTP status.

---

## Demo Scenario (Seeded Clients — docs/07)

Owner: **Maya Rahman**, business **Rahman Design Studio**. Policy: 30% min deposit, max 3 installments, 90 days, 5% max discount, auto-approve below \$1,500, tone friendly.

| Client | Invoice | Amount | Days Overdue | Persona | Notes |
|---|---|---|---|---|---|
| Dana Whitfield (Bright Path Bakery) | Brand identity package | \$900 | 23 | `dana` | late_count 1, high responsiveness |
| Marcus Lee (Lee Logistics) | Website refresh | \$1,250 | 41 | `marcus` | late_count 3, low responsiveness |
| Priya Nair (Nair Wellness) | Social media kit | \$600 | 12 | `priya` | late_count 0, medium responsiveness |
| Tom Brennan (Brennan Tools) | Logo update | \$350 | 6 | `tom` | late_count 0, medium responsiveness |
| Elena Cruz (Cruz Interiors) | Catalog design | \$2,400 | 18 | `elena` | large; above auto-approve threshold |

**Total overdue: \$5,500.** Dana and Marcus have paid history invoices (CH-2026-001/002) so their `late_count`/`avg_days_late` make sense.

**Key demo paths:**
- **Dana** ($900, 23d): runs the main payment-plan flow — agent offers 30% deposit ($270) + 2×$315. Auto-approved (below $1,500 threshold).
- **Marcus** ($1,250, 41d): low responsiveness, chronic late payer — escalation / firm follow-up path.
- **Priya** ($600, 12d): requests 40% discount → `DISCOUNT_REQUEST` escalation → owner counters with 5%.
- **Elena** ($2,400, 18d): plan exceeds auto-approve threshold → `PLAN_NEEDS_SIGNOFF` → owner approves → agent sends offer.
- **Tom** ($350, 6d): short gentle nudge; $350 is below `MIN_PLAN_REMAINING_CENTS` threshold if he requests a plan.

### Current presenter flow

The Dashboard's “Walk through Dana’s payment plan” panel is a three-step guided scenario: send the reminder; add Dana's scripted request and show a policy-checked offer; simulate acceptance and create the installment invoices in PayPal mock mode. The progress indicator and button text follow the persisted messages and plan status. Open Dana's invoice to review the conversation and payment schedule, then click “Simulate $270 deposit payment” to complete the mock payment segment. “Reset demo” restores the fictional seed scenario and clears the demo activity after a confirmation.

This flow uses `ScriptedLLM` and the mock PayPal API even if live providers are configured. It requires no credentials, sends no real client messages, and does not move real money. For a presentation, explain which behavior is deterministic/simulated while showing that the policy checks, plan state, invoice records, and audit trail are real application state.

---

## Hard Rules (Never Break)

1. **Money = integer cents everywhere.** Only convert to decimal strings inside `src/lib/paypal/`.
2. **Policy is enforced in code, not prompt.** Every money-affecting action goes through `src/lib/policy/`.
3. **PayPal Sandbox only.** No live credentials, no live base URL.
4. **No secrets in repo.** Only `.env.example` committed. Never log tokens.
5. **Every agent tool call → `audit_log` row.**
6. **Agent runs bounded:** max 6 iterations, hard timeout, max 1 invoice batch per plan.
7. **Contracts first:** change `src/lib/types.ts` = update `docs/04-contracts.md` in same commit.
8. **Mock mode parity:** `PAYPAL_MODE=mock` must support every flow real mode does.
9. **Deterministic demo:** seeded scenario must run end-to-end reliably.
10. **Client text = untrusted.** Never concatenate into system prompt. Wrap as delimited data.

---

## Key Gotchas & Decisions

- **`getNow()` not `new Date()`** — always use `src/lib/clock.ts`'s `getNow()` so time-travel demo works. Clock offset is persisted in the `kv` table (key: `clock_offset_days`; value is a number of days, converted to ms on read — D31)
- **shadcn/ui**: configured by hand (no `shadcn init`). No components installed yet. To add: `pnpm dlx shadcn@latest add <component>` from a networked machine
- **`db:push` "index already exists"** — known harmless warning; schema is already applied
- **`better-sqlite3`**: ships prebuilt binaries, no `node-gyp` needed. Keep it in `serverExternalPackages` in `next.config.ts`
- **Zod v4 API** — use v4 syntax (e.g. `z.object({}).strict()` not `.nonstrict()`)
- **LLM_MODE=auto** — scripted canned responses when the selected provider has no API key; configure OpenAI-compatible services through `LLM_PROVIDER`, `LLM_BASE_URL`, `LLM_API_KEY`, and `LLM_MODEL`
- **`PAYPAL_MODE=mock`** — safe default; `PAYPAL_MODE=sandbox` needs client id + secret + `PAYPAL_SANDBOX_BUYER_EMAIL`
- **Plans above `autoApproveBelowCents`** — stored as `PENDING_APPROVAL`, client sees nothing until owner approves. On approval → plan becomes `OFFERED` → agent run sends it
- **`rebasePlan` before `create_plan_invoices`** — shifts dates forward if deposit date has passed (advance-time demo case)
- **`chase_state` changed by code only** — never by LLM text. The LLM classifies intent via structured output; handlers change state
- **SSE vs polling** — implement SSE at `/api/events`; UI can fall back to 2s polling if SSE is a time sink
- **DB table name mapping** — `chat_messages` → `messages`, `config` → `owner_policy`, `kv` table added for clock offset. Don't reference old names
- **Render deployment** — free tier sleeps after inactivity; `db:seed` runs on every boot (idempotent). `APP_BASE_URL` set to live Render URL in `render.yaml`
- **`webhook_events` table** — deduplicate PayPal webhooks by PayPal event ID using `upsertWebhookEvent()` which returns `false` on duplicate

---

## Environment Variables

```bash
# App
APP_BASE_URL=http://localhost:3000
DATABASE_PATH=./data/chaser.db
DEMO_NOW=                          # pin ISO date for repeatable demo

# LLM
ANTHROPIC_API_KEY=                 # leave empty for scripted/offline mode
ANTHROPIC_MODEL=claude-sonnet-5-5
LLM_PROVIDER=                      # blank = auto | anthropic | openai-compatible
LLM_BASE_URL=                      # Gemini: https://generativelanguage.googleapis.com/v1beta/openai/
LLM_API_KEY=                       # compatible provider key; do not commit
LLM_MODEL=                         # Gemini: gemini-3.8-flash; Groq: openai/gpt-oss-20b
LLM_MAX_HISTORY=20
LLM_MODE=auto                      # auto | live | scripted

# PayPal (Sandbox only)
PAYPAL_MODE=mock                   # mock | sandbox
PAYPAL_BASE_URL=https://api-m.sandbox.paypal.com
PAYPAL_CLIENT_ID=
PAYPAL_CLIENT_SECRET=
PAYPAL_WEBHOOK_ID=
PAYPAL_SANDBOX_MERCHANT_EMAIL=
PAYPAL_SANDBOX_BUYER_EMAIL=
```

---

## Ownership (for parallel work)

- **Person A — PayPal/backend:** `src/lib/paypal/**`, `src/lib/db/**`, `src/lib/audit.ts`, `src/lib/events.ts`, `src/lib/clock.ts`, API routes for webhooks/demo/mock-paypal/events
- **Person B — AI/agent:** `src/lib/agent/**`, `src/lib/policy/**`, `src/lib/risk/**`, `src/lib/approvals/**`, `src/lib/sim/**`, `src/lib/llm.ts`, `src/evals/**`, API routes for agent/sim
- **Person C — Frontend:** `src/app/(app)/**`, `src/components/**`, `src/lib/client-api.ts`, thin read-only GET handlers

Cross-area changes go through `docs/04-contracts.md` contracts or coordinated PRs.

---

*Handoff updated Nov 3 2026 (OpenAI-compatible LLM providers and guided demo walkthrough documented; last recorded local suite: 268 passed, 1 skipped). Repo: https://github.com/sheikh2583/Paypal-AI-Hackathon | Live: https://paypal-ai-hackathon-9tkr.onrender.com*
