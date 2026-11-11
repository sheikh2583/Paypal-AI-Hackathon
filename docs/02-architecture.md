# 02 — Architecture

## Shape

One Next.js app (App Router) with server-side modules, a SQLite database, a PayPal client (real Sandbox or mock), and an LLM-driven agent that can only act through a fixed set of validated tools.

```
┌──────────────────────────── Browser (owner) ────────────────────────────┐
│ Dashboard · Invoice detail + chat · Approvals · Policy · Audit log       │
└───────────────┬─────────────────────────────────────────────────────────┘
                │ fetch / SSE (or polling)
┌───────────────▼───────────── Next.js route handlers ─────────────────────┐
│ /api/auth/*   /api/agent/run   /api/approvals/*   /api/policy            │
│ /api/webhooks/paypal   /api/demo/*   /api/events (SSE)                    │
└───────┬──────────────┬───────────────┬───────────────┬───────────────────┘
        │              │               │               │
   lib/agent      lib/policy      lib/paypal        lib/db (Drizzle)
 (LLM tool loop)  (allow/deny)  (real | mock)       SQLite
        │              ▲               ▲
        └── tools ─────┘───────────────┘
        lib/llm.ts (Anthropic SDK, OpenAI-compatible fetch adapter, scripted mode)
```

## Key design decisions

1. **Agent proposes, policy disposes.** Tools that move money (`propose_payment_plan`, `create_plan_invoices`) call `lib/policy` which returns `{allowed, violations[]}`. Violations are returned to the LLM as tool errors so it can adjust or escalate.
2. **Risk is computed, not generated.** `lib/risk` computes a 0–100 score from features. The LLM only writes the human-readable explanation from those features.
3. **PayPal behind an interface.** `lib/paypal/index.ts` exports a `PayPalClient` interface. `real.ts` talks to Sandbox; `mock.ts` simulates it in memory/DB. Selected by `PAYPAL_MODE`.
4. **Events over polling where cheap.** A tiny in-process event bus + SSE endpoint pushes updates (new message, invoice paid, approval created) to the UI. Fall back to 2-second polling if SSE is a time sink.
5. **LLM behind an interface.** `lib/llm.ts` wraps the Anthropic SDK and a configurable OpenAI-compatible Chat Completions adapter. `LLM_MODE=scripted` replays canned responses; eligible transient live errors fall back only before a side-effecting tool runs.
6. **Everything auditable.** A single `audit(event)` helper is called by every tool wrapper and every owner action.
7. **Injection-safe by construction.** Client text is never concatenated into the system prompt. It is passed as a quoted data block in a user turn, and tool arguments are validated by Zod and then policy.

## Directory layout

```
src/
  app/
    (app)/
      page.tsx                    # dashboard
      invoices/[id]/page.tsx      # invoice detail + conversation + simulated client
      clients/page.tsx            # owner workspace reliability ranking
      approvals/page.tsx
      policy/page.tsx
      audit/page.tsx
      layout.tsx
    mock-paypal/invoice/[id]/page.tsx  # fake PayPal invoice page (mock mode only)
    api/
      invoices/route.ts, invoices/[id]/route.ts   # read-only, thin (C)
      approvals/route.ts                          # list, thin (C)
      audit/route.ts                              # list, thin (C)
      mock-paypal/pay/route.ts                    # mock mode payment (A)
      agent/run/route.ts
      agent/run-due/route.ts
      sim/client-reply/route.ts
      approvals/[id]/route.ts
      policy/route.ts
      webhooks/paypal/route.ts
      demo/{reset,simulate-payment,advance-time}/route.ts
      events/route.ts
  components/                     # UI components (shadcn/ui under ui/)
  lib/
    types.ts                      # shared contracts (mirrors docs/04)
    env.ts                        # Zod-validated env
    clock.ts                      # getNow()
    money.ts                      # cents helpers, formatting
    audit.ts
    events.ts                     # event bus
    llm.ts
    llm-smoke.ts                 # manual live-mode structured + read-only tool-loop smoke
    db/{schema.ts,client.ts,queries.ts,seed.ts}
    paypal/{index.ts,real.ts,mock.ts,auth.ts,map.ts,reconcile.ts}
    policy/{index.ts,plan.ts,policy.test.ts}
    risk/{index.ts,service.ts,risk.test.ts}   # service.ts: refreshRisk + explainer
    reliability.ts                # pure reliability scoring from stored evidence
    reliability-read.ts           # scoped, read-only database projection
    agent/{run.ts,tools.ts,prompt.ts,classify.ts,scripts.ts,next-action.ts}
    approvals/service.ts          # owner decisions on approvals (B)
    sim/client.ts                 # simulated client personas
    client-api.ts                 # typed fetch helpers for the UI (C)
  evals/{scenarios.ts,run.ts}
data/                              # SQLite file (gitignored)
docs/
prompts/
```

## Request flows

### 0. Single-owner authentication

1. `/setup` creates the one owner account only when the database has no user and the submitted email matches `AUTH_OWNER_EMAIL`; the app closes registration after that first account.
2. Better Auth stores password hashes and sessions in the same SQLite database. It sends email verification and password-reset links through Resend; passwords require at least 14 characters and reset revokes existing sessions.
3. Email OTP is enabled for the owner during account creation. Sign-in requires password and a one-time code; only a verified, OTP-enabled owner session can access the workspace.
4. `/api/auth/[...all]` provides the Better Auth endpoints. The `(app)` layout, mutation routes and mock invoice page independently verify the owner session. Cookies are HttpOnly and SameSite=Lax, with Secure on HTTPS. Configure `BETTER_AUTH_SECRET`, `AUTH_OWNER_EMAIL`, `RESEND_API_KEY`, and `RESEND_FROM`; Better Auth uses `APP_BASE_URL` for email links. Verification tokens are stored as hashes for one-time use; Better Auth reset token identifiers are hashed before storage, and email OTP values use a server-secret HMAC, five-minute lifetime, bounded attempts, and persistent rate limits.

### A. Agent run on an overdue invoice
1. Owner clicks "Run Chaser" (or a scheduled demo trigger).
2. `POST /api/agent/run {invoiceId}` → `agent/run.ts` builds context (invoice, client history, conversation, policy summary, risk).
3. LLM loop (max 6 iterations): LLM calls tools → each tool validates (Zod) → policy check where money is involved → effect → audit → result back to LLM.
4. Run ends with a final state (`NUDGED`, `NEGOTIATING`, `PLAN_OFFERED`, `ESCALATED`, `NO_ACTION`) and a short summary stored on the invoice conversation.

### B. Client replies (simulated)
1. UI: owner or demo script triggers `POST /api/sim/client-reply {invoiceId, persona?, text?}`.
2. If `text` is absent, the persona generates a reply (LLM or scripted). The message is stored as `from: client`.
3. The agent is invoked again for that invoice (flow A) with the new message.

### C. Plan accepted and paid
1. Client message accepts the offered plan → agent calls `create_plan_invoices(planId)` → policy re-check → PayPal `createInvoice` + `sendInvoice` per installment → local rows created; then the original is cancelled in PayPal and marked `SUPERSEDED` (see `docs/DECISIONS.md` D6).
2. Payment happens on the PayPal invoice page (Sandbox) or via `POST /api/demo/simulate-payment`.
3. Webhook (`INVOICING.INVOICE.PAID`) or polling reconciler updates the local invoice → event → UI updates live.

## Non-functional

- **Performance:** single-user demo; no caching needed. Agent run target < 15 s per step.
- **Resilience:** all PayPal calls have timeouts, idempotency keys (`PayPal-Request-Id`) and retries on 5xx only. Webhook handler is idempotent (dedupe by event id).
- **Security:** Sandbox only; verify webhook signatures in sandbox mode; never expose server env to the client; sanitize rendered message text. Protect owner pages and mutation APIs with the signed demo session; only the login endpoints and PayPal webhooks are public.
- **Testing pyramid:** unit tests for policy/risk/plan math/money; contract tests for PayPal mock vs real shapes; agent evals (scenarios) for behavior; one Playwright-style smoke test is optional.
