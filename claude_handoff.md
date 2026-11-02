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
| LLM | `@anthropic-ai/sdk` 1.3.0 tool-use loop, always behind `src/lib/llm.ts`. Model from `ANTHROPIC_MODEL` (default `claude-sonnet-5-5`). `LLM_MODE=auto` = scripted when no API key, live otherwise |
| PayPal | Direct REST fetch from `src/lib/paypal/`. `PAYPAL_MODE=mock` = fully fake. `PAYPAL_MODE=sandbox` = real Sandbox API |
| Package manager | `pnpm` 10.28.0 |
| Node | 22.23.4 |

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
```

**Before declaring any task done:** `pnpm typecheck && pnpm lint && pnpm test` must all pass.

---

## Current State (as of Nov 3 2026)

### ✅ What exists and works
- Full DB schema (Drizzle + SQLite) with all tables: `clients`, `invoices`, `plans`, `installments`, `audit_log`, `approvals`, `chat_messages`, `config`
- Seed script with 5 demo clients/invoices (Elena $2,400 · Priya $1,800 · Marcus $960 · Olivia $1,250 · Noah $540 — all overdue)
- `src/lib/types.ts` — all shared types and contracts
- `src/lib/env.ts` — Zod-validated env (groups: app, llm, paypal)
- `src/lib/clock.ts` — `getNow()` with offset seam for time-travel demo
- `src/lib/money.ts` — cents helpers, formatting
- `src/lib/audit.ts` — audit helper
- `src/lib/events.ts` — in-process event bus
- Placeholder pages for all routes (Coming Soon stubs): `/`, `/invoices/[id]`, `/approvals`, `/policy`, `/audit`, `/mock-paypal/invoice/[id]`
- Shared components: `app-nav.tsx`, `page-header.tsx`, `empty-state.tsx`
- 56 passing unit tests (money, env, clock, queries, seed)
- `vitest.config.mts`, `tsconfig.json`, `next.config.ts`, `drizzle.config.ts`, `tailwind.config.ts` all configured
- `.env.example` documents all required env vars

### 🚧 Not yet built (stubs / placeholders)
- `src/lib/paypal/` — real + mock PayPal client implementations
- `src/lib/policy/` — plan evaluation logic
- `src/lib/risk/` — risk scoring + explainer
- `src/lib/agent/` — LLM tool-use loop, tools, prompt, classifier, scripts, next-action
- `src/lib/llm.ts` — LLM wrapper
- `src/lib/approvals/service.ts` — owner decision handling
- `src/lib/sim/client.ts` — simulated client personas
- `src/lib/client-api.ts` — typed fetch helpers for UI
- All API route handlers (agent, sim, approvals, policy, audit, webhooks, demo, events, mock-paypal)
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
    llm.ts                        # Anthropic wrapper
    utils.ts                      # cn() etc
    db/{schema.ts,client.ts,queries.ts,seed.ts,test-utils.ts}
    paypal/{index.ts,real.ts,mock.ts,auth.ts,map.ts,reconcile.ts}
    policy/{index.ts,plan.ts}
    risk/{index.ts,service.ts}
    agent/{run.ts,tools.ts,prompt.ts,classify.ts,scripts.ts,next-action.ts}
    approvals/service.ts
    sim/client.ts
    client-api.ts
  evals/{scenarios.ts,run.ts,evals.test.ts}
data/                             # SQLite file (gitignored)
docs/
  02-architecture.md
  04-contracts.md
  DECISIONS.md
```

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
| `POST /api/demo/reset` | – | reseeds DB |
| `POST /api/demo/simulate-payment` | `{invoiceId, amountCents?}` | local id → simulate payment |
| `POST /api/demo/advance-time` | `{days}` | shifts `getNow()` |
| `GET /api/events` | – | SSE stream `{type, invoiceId, at}` |

**Error shape:** `{ error: { code: string, message: string } }` with appropriate HTTP status.

---

## Demo Scenario (Seeded Clients)

| Client | Invoice | Amount | Days Overdue | Scenario |
|---|---|---|---|---|
| Elena Martinez | CH-2026-101 | $2,400 | 23 | Main story: requests plan → above auto-approve threshold → owner signs off → agent sends offer → Elena accepts → installment invoices created |
| Priya Shah | CH-2026-102 | $1,800 | 31 | Requests 40% discount (out of bounds) → escalates as `DISCOUNT_REQUEST` → owner counters 5% → agent relays → negotiation |
| Marcus Lee | CH-2026-103 | $960 | 14 | Standard nudge → accepts plan within policy |
| Olivia Chen | CH-2026-104 | $1,250 | 9 | Early chase → schedules follow-up |
| Noah Williams | CH-2026-105 | $540 | 5 | Short gentle nudge |

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

- **`getNow()` not `new Date()`** — always use `src/lib/clock.ts`'s `getNow()` so time-travel demo works
- **shadcn/ui**: configured by hand (no `shadcn init`). No components installed yet. To add: `pnpm dlx shadcn@latest add <component>` from a networked machine
- **`db:push` "index already exists"** — known harmless warning; schema is already applied
- **`better-sqlite3`**: ships prebuilt binaries, no `node-gyp` needed. Keep it in `serverExternalPackages` in `next.config.ts`
- **Zod v4 API** — use v4 syntax (e.g. `z.object({}).strict()` not `.nonstrict()`)
- **LLM_MODE=auto** — scripted canned responses when `ANTHROPIC_API_KEY` is empty; set the key for live agent behavior
- **`PAYPAL_MODE=mock`** — safe default; `PAYPAL_MODE=sandbox` needs client id + secret + `PAYPAL_SANDBOX_BUYER_EMAIL`
- **Plans above `autoApproveBelowCents`** — stored as `PENDING_APPROVAL`, client sees nothing until owner approves. On approval → plan becomes `OFFERED` → agent run sends it
- **`rebasePlan` before `create_plan_invoices`** — shifts dates forward if deposit date has passed (advance-time demo case)
- **`chase_state` changed by code only** — never by LLM text. The LLM classifies intent via structured output; handlers change state
- **SSE vs polling** — implement SSE at `/api/events`; UI can fall back to 2s polling if SSE is a time sink

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

*Handoff generated Nov 3 2026. Repo: https://github.com/sheikh2583/Paypal-AI-Hackathon*
