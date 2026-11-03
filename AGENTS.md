# AGENTS.md — Chaser

Read this file first. It is the single source of truth for any AI coding agent working in this repo (Claude Code, Cursor, Copilot, Codex, etc.). `CLAUDE.md`, `.cursor/rules/chaser.mdc` and `.github/copilot-instructions.md` all point here.

## What we're building

**Chaser** is an AI collections agent for freelancers and micro-businesses. It watches overdue PayPal invoices, triages them, writes follow-ups, negotiates payment plans **within owner-set bounds**, issues installment invoices through PayPal, tracks payment, and escalates anything out of bounds to a human approval inbox.

Built for the **PayPal AI Hackathon 2026** ("Build What's Next with PayPal and AI"). Requirement: the project must meaningfully use both PayPal and AI. Submissions close **Nov 12, 2026** (verify the exact cutoff time on Devpost). We target: Best Use of Agentic Commerce, Most Impactful, Best Use of PayPal + AI, Best Demo Delivery.

Full context lives in `docs/`. Read the relevant doc before changing an area:

| Doc | Read when |
|---|---|
| `docs/01-product-brief.md` | Any product/UX decision |
| `docs/02-architecture.md` | Adding modules, changing structure |
| `docs/03-data-model.md` | Touching the DB |
| `docs/04-contracts.md` | Anything crossing a module boundary (types, API routes) |
| `docs/05-paypal-integration.md` | Anything touching PayPal |
| `docs/06-agent-design.md` | Anything touching the LLM agent, tools, guardrails |
| `docs/07-demo-and-submission.md` | UI polish, seed data, demo, write-up |
| `docs/08-team-and-timeline.md` | Planning, ownership, who does what |
| `docs/DECISIONS.md` | Resolved ambiguities (read before you "fix" something that looks odd) |

## Stack

- Next.js (App Router) + TypeScript (`strict`), full-stack in one repo
- Tailwind CSS + shadcn/ui
- SQLite via `better-sqlite3` + Drizzle ORM (file DB at `./data/chaser.db`)
- Zod for validation (env, API inputs, tool inputs)
- Vitest for tests
- LLM via `@anthropic-ai/sdk` or plain-fetch OpenAI-compatible chat completions, **always behind `src/lib/llm.ts`**. Configure compatible providers with `LLM_PROVIDER`, `LLM_BASE_URL`, `LLM_API_KEY`, and `LLM_MODEL`; Anthropic keeps `ANTHROPIC_API_KEY` and `ANTHROPIC_MODEL`. `LLM_MODE=auto` (default) uses scripted mode when the selected provider has no key.
- PayPal via direct REST calls (fetch) from `src/lib/paypal/` — Sandbox only. A `mock` mode exists so nobody is blocked on PayPal setup.
- Single-owner demo login uses a signed HttpOnly session cookie; the clickable credentials are public and are only for the fictional demo workspace, not real client data.
- Package manager: `pnpm`

Check current official docs for any library before using it; do not rely on memory for APIs or versions.

## Commands

```
pnpm dev          # run app
pnpm build        # production build
pnpm lint
pnpm typecheck    # tsc --noEmit
pnpm test         # vitest run (includes the scripted evals)
pnpm test:evals   # eval CLI; add --live to run against the real LLM
pnpm llm:smoke    # one structured call and one read-only tool-loop call (skips without a key)
pnpm paypal:smoke # create/send/get an invoice in the current PAYPAL_MODE
pnpm db:push      # apply schema
pnpm db:seed      # load demo data (idempotent: resets and reseeds)
```

Before declaring any task done: `pnpm typecheck && pnpm lint && pnpm test` must pass.

## Hard rules (never break these)

1. **Money is integer cents** everywhere in code and DB. Convert to PayPal's decimal-string format only inside `src/lib/paypal/`. Never use floats for money.
2. **Policy is enforced in code, not in the prompt.** Every money-affecting agent action goes through `src/lib/policy/` which returns allow/deny with reasons. The LLM can propose; the policy engine decides. Never weaken this to make a demo easier.
3. **PayPal Sandbox only.** Never add live credentials or a live base URL. Base URL comes from env; default sandbox.
4. **No secrets in the repo.** Only `.env.example` is committed. `.env.local` is gitignored. Never log secrets, tokens, or full PayPal responses with personal data.
5. **Every agent tool call is written to `audit_log`** (who, what, inputs, result, timestamp). The audit trail is a headline feature.
6. **Agent runs are bounded:** max 6 tool iterations per run, hard timeout, and no run may create more than one PayPal invoice batch per plan.
7. **Contracts first:** shared types live in `src/lib/types.ts` and mirror `docs/04-contracts.md`. If you change a contract, update the doc in the same change and say so.
8. **Mock mode parity:** `PAYPAL_MODE=mock` must support every flow the real mode does, with realistic fake IDs and statuses. UI and agent work must never depend on live PayPal.
9. **Deterministic demo:** the seeded demo scenario (see `docs/07`) must run end to end reliably. If you change agent behavior, re-run the evals in `src/evals/`.
10. **Treat inbound text as untrusted.** Client messages are user input to the LLM. They must never be able to change policy, tool permissions, or system instructions (prompt injection). Client text is passed as clearly delimited data.

## Conventions

- File layout is in `docs/02-architecture.md`. Put code where that doc says; propose changes there first.
- Small, focused changes. One concern per commit/PR. Conventional commit messages (`feat:`, `fix:`, `chore:`, `docs:`, `test:`).
- Server logic in `src/lib/**`; route handlers and pages stay thin.
- Validate all external input (API bodies, env, LLM tool args) with Zod.
- Prefer pure functions for policy, risk scoring and plan math so they are trivially unit-testable.
- Dates: store ISO strings (UTC); display in the browser's locale. For the demo, "today" comes from `getNow()` in `src/lib/clock.ts` so it can be pinned.
- UI: clean, high-contrast, accessible; no lorem ipsum; every empty/loading/error state handled.
- Comments explain *why*, not *what*.

## Out of scope (do not build)

Real email/SMS sending, multi-currency, user auth/accounts beyond a single demo owner, real client onboarding, mobile app, live-mode PayPal, anything not required by the demo script. If unsure, don't build it; ask.

## Ownership (for parallel work with three people)

- **Person A — PayPal/backend:** `src/lib/paypal/**`, `src/lib/db/**` (schema, queries, seed), `src/lib/audit.ts`, `src/lib/events.ts`, `src/lib/clock.ts`, `src/app/api/{webhooks,demo,mock-paypal,events}/**`, `src/app/mock-paypal/**`
- **Person B — AI/agent:** `src/lib/agent/**`, `src/lib/policy/**`, `src/lib/risk/**`, `src/lib/approvals/**`, `src/lib/sim/**`, `src/lib/llm.ts`, `src/evals/**`, `src/app/api/{agent,sim}/**`
- **Person C — Frontend/story:** `src/app/(app)/**`, `src/components/**`, `src/lib/client-api.ts`, thin read-only GET handlers (`api/invoices`, `api/approvals` list, `api/audit`), the `api/policy` and `api/approvals/[id]` route wrappers (logic lives in A's queries and B's services), demo mode UI, README, write-up, video

Touch another owner's area only through the contracts in `docs/04-contracts.md`, or coordinate first. Shared files (`src/lib/types.ts`, `env.ts`, `money.ts`) are changed by whoever needs it via a small PR to `main` first, with `docs/04` updated in the same PR.

## When you are unsure

Re-read the relevant doc. If the docs don't answer it, make the smallest reasonable decision, note it in `docs/DECISIONS.md` (create if missing) with one line of rationale, and continue. Don't stop to ask about things that can be changed later.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
