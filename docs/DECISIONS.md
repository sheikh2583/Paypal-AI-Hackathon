# Decisions

Resolved before prompt 01, in response to the gap review after prompt 00. Each entry says what was decided and where the docs/prompts were patched. Add new entries at the bottom; keep them one or two lines.

## Blocking gaps

**D1. Missing types.** `docs/04` now has an "Additional types" section defining `ClientRow`, `InvoiceRow`, `PlanRow`, `ApprovalRow`, `AuditEntry`, `InvoiceListItem`, `ReplyClassification`, `ToolCallRecord`, `AgentRunResult`, `RunOutcome`, and the status/kind unions. Prompt 01 copies all of them into `src/lib/types.ts`.

**D2. Mock payment route.** The mock invoice page posts the *mock PayPal invoice id* to `POST /api/mock-paypal/pay` (built in prompt 03, owner A). `POST /api/demo/simulate-payment` (prompt 09) takes a *local* invoice id, resolves its PayPal id and calls the same function.

**D3. LLM_MODE default.** `LLM_MODE=auto` is the default: scripted when `ANTHROPIC_API_KEY` is empty, live otherwise. `live` and `scripted` still force a mode. This keeps the no-keys quick start true.

**D4. Follow-ups, risk, next action.**
- `invoices.next_followup_at` added. `schedule_followup` sets it. `POST /api/agent/run-due` runs the agent for invoices whose follow-up is due; the dashboard has a "Run all due" button.
- `src/lib/risk/service.ts` `refreshRisk(invoiceId)` computes features, stores `risk_score`/`risk_factors`, and caches a 1–2 sentence explanation. `unansweredNudges` = agent messages since the last client message. Called by seed, after any message, after payment, and on advance-time.
- `nextAction()` is a pure function in `src/lib/agent/next-action.ts` that feeds the dashboard column.

**D5. Plans above the auto-approve threshold.** The plan is stored as `PENDING_APPROVAL` and an approval of kind `PLAN_NEEDS_SIGNOFF` is created. The client does **not** see terms until the owner approves; the agent only tells the client it is confirming with the owner. On approval the plan becomes `OFFERED` and an agent run sends it. Elena's $2,400 plan follows this path (counter → sign-off → offer → she accepts).

**D10. Ownership and layout.** `AGENTS.md` and `docs/02` now list every route and file, including `reconcile.ts`, `classify.ts`, `scripts.ts`, `next-action.ts`, `risk/service.ts`, `approvals/service.ts`, `client-api.ts`, the mock-paypal page and routes. `state.ts` removed. Rule: read-only GET handlers and the policy PUT are thin and written by C over A's queries and B's services; mutating logic lives in `src/lib/**` under its owner. Shared files (`types.ts`, `env.ts`, `money.ts`) change via a small PR to `main` first.

## Behavior and math

**D6. Original invoice handling.** MVP plans only unpaid originals (`status = OVERDUE`, `paid_cents = 0`); `PARTIALLY_PAID` is escalated. `create_plan_invoices` creates and sends all installment invoices first (compensating by cancelling any already created if one fails), then cancels the original in PayPal. If the cancel fails, the original is still marked `SUPERSEDED` locally and a `PAYPAL_ERROR` approval is raised. A payment arriving on a `SUPERSEDED` invoice raises an `UNEXPECTED_PAYMENT` approval for the owner (refund/credit is manual). Cancel behavior for partially paid invoices is moot in the MVP but should be verified in current PayPal docs.

**D7. URL allowlist.** `send_message` may include the recipient-view URL of the invoice itself and of any invoice in the same plan (`allowedUrlsForInvoice`). No other URLs.

**D8. Policy math.**
- `discountedTotal = floor((remaining × (100 − discount) + 50) / 100)`.
- `minDeposit = ceil(discountedTotal × minDepositPercent / 100)`.
- Remaining installments are `floor((discountedTotal − deposit) / (n − 1))`; the rounding remainder goes on the last one.
- `suggestPlan` uses the **minimum** deposit (not "largest"); deposit due `now + 3 days`, later installments every 30 days, clamped to `now + maxPlanDays`. Requested count is clamped to `[2, maxInstallments]`.
- Invoices with `remaining < MIN_PLAN_REMAINING_CENTS` (10000) get `PLAN_TOO_SMALL`.
- Date rules use the evaluation time. Before the re-check in `create_plan_invoices`, `rebasePlan(proposal, now)` shifts all dates forward (preserving spacing) if the deposit date has passed; if the rebased plan then violates `PLAN_TOO_LONG`, escalate as `PLAN_OUT_OF_BOUNDS`. This fixes the Advance-time case.

**D9. Run outcomes vs chase_state.** `chase_state` is changed by tool effects and handlers in code, never by LLM text (see `docs/06`, "Chase state transitions"). The run returns a `RunOutcome` (`NUDGED | PLAN_OFFERED | PLAN_ACTIVE | ESCALATED | WAITING | NO_ACTION`) derived from the last effect; `NO_ACTION` leaves `chase_state` unchanged.

## Process and tooling

**D11.** Day 2 is prompts 00–01 together; A then starts 02. `tsx` added to prompt 01's dependencies. `pnpm test` = `vitest run` and includes the scripted evals via `src/evals/evals.test.ts`; `pnpm test:evals` is the CLI (supports `--live`). Prompt 01 tells the agent to allow `better-sqlite3`'s native build under pnpm 10 (`pnpm.onlyBuiltDependencies` or `pnpm approve-builds`) and confirm it loads. **Correction:** the assumption that `better-sqlite3` v13 needs a native build was wrong; it ships prebuilt binaries, and pnpm's implicit `node-gyp rebuild` is unnecessary.

**D12. Injection coverage.** `docs/06` lists five cases (fake closing tag added). Scripted evals verify the **guardrail layer** (policy, tool validation, client-text wrapping) and cannot measure model behavior; only live runs do, and `docs/evals.md` must say so. The classifier input is wrapped with `wrapClientMessage` like the agent's.

**D13. Demo and seed.**
- Dana is a bakery owner (persona table fixed).
- Priya: the *request* (40%) is out of bounds, so it escalates as `DISCOUNT_REQUEST`. The owner's decision is a counter (e.g. 5% goodwill, which is within policy); the approval service writes an `owner_note` and triggers an agent run that relays it.
- In `PAYPAL_MODE=sandbox` the seed sets every client email to `PAYPAL_SANDBOX_BUYER_EMAIL`; otherwise it uses fake `@example.com` addresses.

**D14. Files "not provided".** `.env.example`, `.cursor/rules/chaser.mdc` and `.mcp.json.example` are in the zip. They are dotfiles and may be hidden by some file listings (use `ls -la` or enable hidden files).

## Prompt 01 (scaffold)

**D15. Location and kit files.** Built in an external Claude session whose working directory was a home folder (dotfiles, not a repo). Copied in from the Project: `AGENTS.md`, `.env.example`, `.gitignore`, `docs/02-architecture.md`, `docs/04-contracts.md`, `docs/DECISIONS.md`. Everything else in the kit (`CLAUDE.md`, `README.md`, `docs/01,03,05–08`, `prompts/`, `.cursor/`, `.github/`) was not copied; merge this tree into the real repo without overwriting those.

**D16. Versions.** Node 22.23.4, pnpm 10.28.0, Next 16.4.3 (Turbopack), React 19.3.0, Tailwind 4.3.3 (via `@tailwindcss/turbopack`), TypeScript 5.9.3, ESLint 9.39.5, Zod 4.6.7 (v4 API), drizzle-orm 0.45.4, drizzle-kit 0.31.11, better-sqlite3 13.0.3, @anthropic-ai/sdk 1.3.0, nanoid 6.0.2, vitest 5.0.5, tsx 4.23.15.

**D17. `cacheComponents` off.** `create-next-app` enables it by default; it forces `use cache`/Suspense around every DB read and `new Date()`, which fights a dynamic single-user app. Removed it and `partialPrefetching` from `next.config.ts`; added `serverExternalPackages: ["better-sqlite3"]`.

**D18. Generated agent rules block.** Scaffolded with `--no-agents-md` so ours is not overwritten, but `next dev` still appends a "Next.js agent rules" block to `AGENTS.md` and re-adds it on every run. Left in place; the team decides whether to commit or strip it.

**D19. shadcn/ui is configured by hand.** `ui.shadcn.com` was unreachable from the build environment, so `shadcn init` could not run. Wrote `components.json` (new-york, neutral, lucide), `src/lib/utils.ts` (`cn`) and the theme tokens in `globals.css`. No shadcn components are installed yet. On a networked machine run `pnpm dlx shadcn@latest init` and compare its `components.json`/CSS with ours before `shadcn add`.

**D20. Fonts and theme.** System font stack (`next/font/google` needs network at build). Light theme only so the demo looks identical everywhere.

**D21. Scripts.** `db:push` (`drizzle-kit push`) and `db:seed` (`tsx src/lib/db/seed.ts`) point at files prompt 02 creates (`drizzle.config.ts`, `seed.ts`) and fail until then. `paypal:smoke` is omitted until prompt 03. `test:evals` runs the placeholder `src/evals/run.ts`. `tsx` does not load `.env.local` (Next does), so A must handle env loading for `db:seed` in prompt 02.

**D22. `types.ts` scope.** Besides the shared and additional types, it includes the `PayPalClient`, `CreateInvoiceInput` and `PayPalInvoice` interfaces from `docs/04`. Policy signatures, the tool table and the HTTP table stay doc-only.

**D23. Env behavior.** `getAppEnv`/`getLlmEnv`/`getPayPalEnv` validate only their own group and accept an optional source object (for tests). Blank values count as unset. `PAYPAL_BASE_URL` must be a sandbox host (hard rule 3); `PAYPAL_MODE=sandbox` requires client id and secret; `LLM_MODE=live` requires an API key. Errors name variables, never values. `env.test.ts` fails if the schema and `.env.example` drift apart.

**D24. Clock offset is a stub.** `getClockOffsetMs()` is the seam and is backed by an in-process variable, which is not shared across Next workers. A replaces it with a DB read in prompt 02/09.

**D25. Test setup.** `vitest.config.mts` (ESM, `@` alias, `src/**/*.test.ts`). 56 tests cover money, env and clock.

**D26. Routes.** Placeholder "Coming soon" pages exist for `/`, `/invoices/[id]`, `/approvals`, `/policy`, `/audit` and `/mock-paypal/invoice/[id]`. Removed the default `favicon.ico`.

**D27. better-sqlite3 build.** `better-sqlite3` v13 ships prebuilt binaries in the package, so pnpm's implicit `node-gyp rebuild` is unnecessary and fails on Windows without Visual Studio. Removed it from `pnpm.onlyBuiltDependencies`; `esbuild` remains allowed to run its build script.

**D28. Database schema source.** `docs/03-data-model.md` was absent from both project copies, so the Drizzle columns and indexes were inferred from `src/lib/types.ts`, `docs/04-contracts.md`, and the requested query paths; average late days use a real column because the shared row type is numeric.

**D29. Seed scenario source.** `docs/07-demo-and-submission.md` was absent from both project copies. Preserved the known Elena $2,400 plan and Priya discount scenario, then filled three additional clients, invoice amounts, due offsets (23, 31, 14, 9, and 5 days), owner policy defaults, and two paid history invoices as deterministic demo assumptions.

**D30. SQLite checks.** Drizzle Kit 0.31.11 rebuilt unchanged SQLite tables on repeated `db:push` when SQL `CHECK` constraints were present, then emitted duplicate index creation. Omitted optional SQL checks so push is idempotent; status and kind values remain constrained by the Drizzle TypeScript unions.

## Prompt 03 (PayPal integration)

**D31. Clock KV key mismatch.** The handoff doc (`claude_handoff.md`) said the KV key was `"clock_offset_ms"`. The actual code in `src/lib/clock.ts` uses `"clock_offset_days"` (the value stored is a number of days, converted to ms on read). All code in this repo uses `"clock_offset_days"`. The handoff has been corrected; no code change needed.

**D32. `docs/05-paypal-integration.md` absent.** The file referenced in AGENTS.md does not exist in the repo. The real client in `src/lib/paypal/real.ts` was built from current official PayPal developer documentation (Nov 2026) and is marked UNVERIFIED until tested against live Sandbox credentials. Key API facts sourced: OAuth2 `POST /v1/oauth2/token` client-credentials; Invoicing v2 endpoints (`POST /v2/invoicing/invoices`, `/send`, `/cancel`, `GET /v2/invoicing/invoices/{id}`); `recipient_view_url` lives at `detail.metadata.recipient_view_url` in the GET response; send returns `202`; cancel returns `204`.

**D33. PayPal status SENT vs UNPAID.** PayPal's Invoicing v2 API uses the status string `"SENT"` in response objects (confirmed from docs: DRAFT → SENT after send). Our `PayPalInvoice.status` contract uses `'SENT'`; `map.ts` maps it directly. No discrepancy.

**D34. PayPal create response shape.** `POST /v2/invoicing/invoices` returns `201` with the invoice object JSON containing `id` (the paypal invoice id, e.g. `INV2-XXXX-...`) and a `detail.metadata` block. The `recipient_view_url` is only populated after send (or may require a GET after create). Real client calls GET after send to fetch the final URL. UNVERIFIED until sandbox credentials are available.

**D35. `PAYPAL_MODE=mock` smoke test is the acceptance gate.** Sandbox credentials are not present in this environment. `PAYPAL_MODE=sandbox pnpm paypal:smoke` cannot be verified; this is noted in the final report. The real client is built correctly per the docs but marked UNVERIFIED (D32).

**D36. Mock invoice ID format.** Mock PayPal invoice IDs use the format `MOCK-INV2-<uuid-prefix>` (first 8 chars of a UUID) to be clearly non-real while matching `INV2-` prefix convention. This is stored in `mock_paypal_invoices.id` and surfaced as `paypalInvoiceId` in our `PayPalInvoice` type.

**D38. Risk label thresholds.** `riskLabel(score)` returns: `< 35` → Low, `35–64` → Medium, `≥ 65` → High. Rationale: a freshly-seeded invoice (10 base + 20 overdue for 15-30 days + 5 medium-amount) scores ~35 — Medium feels right at that boundary. Low covers genuinely low-risk recent invoices; High starts at 65 which requires multiple compounding factors (very overdue + high amount + poor history).

**D39. `docs/03-data-model.md` and `docs/06-agent-design.md` absent.** Both referenced in AGENTS.md but not present in the repo. Risk feature table for prompt 04 was provided inline in the prompt; implemented as specified. No schema deviation from what `src/lib/types.ts` and `docs/04-contracts.md` already define.

**D37. reconcile idempotency mechanism.** `reconcilePayPalInvoices()` checks status before updating: if local status already matches the PayPal-derived status, it skips the update and emits no event, preventing duplicate audit rows and events on repeated runs. For UNEXPECTED_PAYMENT on SUPERSEDED invoices, it checks for an existing PENDING approval of kind `UNEXPECTED_PAYMENT` for that invoice before inserting a new one.

## Prompt 05 (schema + seed alignment)

**D40. Schema aligned with docs/03.** Three deviations corrected: (1) `owner_policy.updated_at` column added (text, NOT NULL DEFAULT ''). (2) `webhook_events.processed_at` column added (text, nullable) — set when handler finishes. (3) `invoices` indexes: replaced two separate `(status)` and `(due_at)` indexes with the composite `(status, due_at)` that docs/03 specifies; other indexes retained. `test-utils.ts` updated to match. `OwnerPolicy` type gains optional `updatedAt` field; queries and upsert updated accordingly.

**D41. `clients.email` UNIQUE index removed.** docs/03 does not specify it. In `PAYPAL_MODE=sandbox` the seed sets every client email to `PAYPAL_SANDBOX_BUYER_EMAIL` so all five share one address — the UNIQUE constraint would block that. Removed from both schema.ts and test-utils.ts.

**D42. Seed reconciled with docs/07.** Old seed used fictional names (Elena Martinez, Priya Shah, Marcus Lee, Olivia Chen, Noah Williams) and amounts ($2,400 / $1,800 / $960 / $1,250 / $540 = $5,950) that don't match docs/07. New seed uses exact names, amounts and days from docs/07: Dana Whitfield $900/23d, Marcus Lee $1,250/41d, Priya Nair $600/12d, Tom Brennan $350/6d, Elena Cruz $2,400/18d — total $5,500. Owner policy updated to Maya Rahman / Rahman Design Studio, min deposit 30%, max 3 installments, 90 days, 5% discount, auto-approve below $1,500 (150,000 cents).

**D43. Seed silent-field choices.** docs/07 is silent on avg_days_late, and per-client responsiveness for priya, tom, elena. Choices made: dana avg_days_late=8 (one late invoice, moderate); marcus avg_days_late=22 (three late invoices, chronic); priya/tom/elena avg_days_late=0 (late_count=0 or first-time). priya responsiveness=medium (neutral, no demo requirement); tom responsiveness=medium (new client, neutral); elena responsiveness=medium (large invoice, but no stated history). History invoices: dana gets one PAID invoice (CH-2026-001, $600, 75d ago), marcus gets one (CH-2026-002, $800, 120d ago) to back up their late counts. Persona keys are exactly `dana, marcus, priya, tom, elena` per docs/07.

## Prompt 06 (consistency fixes)

**D44. `OwnerPolicy.updatedAt` added to docs/04.** Prompt 05 added `updatedAt?` to `src/lib/types.ts` and `schema.ts` without updating `docs/04-contracts.md` (violating hard rule 7). Fixed: `docs/04-contracts.md` now includes `updatedAt?: string` with a comment that it is metadata set by the DB layer, not a policy rule.

**D45. `webhook_events.event_type` kept as-is; not renamed to `type`.** docs/03 describes the column informally as `type`. The Drizzle field is `eventType` → DB column `event_type`. Renaming requires a destructive table rebuild which `drizzle-kit push` resolves via an interactive prompt — this would hang on Render's non-TTY start command. Decision: keep `event_type` and document the deviation. The column is functionally identical; no code outside `schema.ts` and `queries.ts` touches it by name.

**D46. `db:push` idempotency confirmed on existing DB.** After the prompt 05 schema additions (`updated_at`, `processed_at`), running `pnpm db:push` a second time reports "No changes detected" — fully safe for Render's start command. Column renames are the only case that would block (non-TTY interactive prompt); avoided by D45.

## Agent implementation

**D47. Installed Anthropic SDK typing.** The installed `@anthropic-ai/sdk` 1.3.0 exposes message and tool types through `Anthropic.Messages`; `zodOutputFormat()` is nested under `output_config.format`. This differs from the newer SDK examples, so `llm.ts` follows the installed package types. Scripted turns persist per persona and resolve invoice, plan, and date placeholders from the current run/context so offline demo actions use real seeded IDs and amounts.

**D48. Silent-client escalation threshold.** After four `agent_to_client` reminders since the latest client reply, escalate with the existing `UNCLEAR` approval kind. Enforce this in the runner and also include it in the system prompt; system summaries do not count as reminders.

**D49. Seeding is asynchronous.** `seedDatabase` now awaits risk refresh for every seeded invoice so scores and explanations are present before `pnpm db:seed` completes; its direct CLI entry point and tests await the returned summaries.

**D50. OpenAI-compatible providers use one configurable adapter.** Gemini, Groq, and OpenRouter vary in model support and structured-output guarantees, so Chaser uses a plain-fetch Chat Completions adapter with Zod validation and JSON-object output instead of provider-specific SDKs. Provider URL and model stay configurable; example presets are convenience values verified in current official docs. Live-provider transient failures can fall back to deterministic scripted behavior only before any side-effecting tool.

**D51. Demo UI runs a persisted, scripted Dana stepper.** A public hackathon demo must work without provider credentials and survive server restarts. The “Run next Dana step” endpoint derives the next scripted turn from invoice messages and plan status, while payment simulation stays behind the existing mock PayPal API. Reset restores only the app's fictional seed data and is guarded by an accessible in-app confirmation dialog.

**D52. Presenter progress is derived from demo records.** The Dana walkthrough indicator derives its completed stage from persisted client/agent messages and plan status; it adds no separate demo-progress state that could drift from the invoice. Payment completion is shown from the first installment invoice's paid amount.

**D53. Single-owner authentication uses Better Auth and email OTP.** Public demo credentials and the hand-rolled cookie were removed. Better Auth stores password hashes and sessions in the existing SQLite database; only the first account matching `AUTH_OWNER_EMAIL` may register. Email verification, password reset, and email OTP use Resend, and the owner must complete password plus OTP before workspace access. Provider credentials and sender are deployment configuration, never committed. This remains single-owner auth, not multi-user provisioning.

**D54. Auth email security and Resend sender mode.** Use Resend's official server SDK with `RESEND_API_KEY` and `RESEND_FROM`; generated links use `APP_BASE_URL`. Email verification is a signed 24-hour token whose SHA-256 digest is stored and atomically consumed. Better Auth password-reset identifiers are SHA-256 hashed before persistence and consumed by its reset flow; email OTP values use a server-secret HMAC, five-minute TTL, bounded attempts, and database-backed per-endpoint rate limits. The `onboarding@resend.dev` testing sender is explicitly labeled as restricted and does not promise delivery to arbitrary recipients. Better Auth migrations plus the new verification-token and rate-limit tables are additive; no existing project tables or records are removed.

**D55. Production startup never seeds or pushes the business database.** Render startup runs only Better Auth's additive auth-schema setup and the app server; `db:seed` remains an explicit manual demo command, while `db:push` is kept for local development. Use versioned, reviewed Drizzle migrations for future production business-schema changes after a safe baseline strategy for the existing database is established. The current Render Free service has no persistent disk support, so SQLite persistence requires an approved storage/plan change or migration to a managed persistent database before treating production records as durable.

## Render demo deployment (D56)

**D56. DEMO_PUBLIC flag and ephemeral-DB startup sequence.** Render Free wipes SQLite on every spin-down; Resend's test sender only emails the account owner; the old startCommand never created business tables or seed data. Three problems, one flag:

- `DEMO_PUBLIC=1` (new env var, off by default): `getDemoSession`/`isDemoRequestAuthenticated` return authenticated without touching Better Auth; `getAuthReadiness` always returns `{ ready: true, missing: [] }`; `/login` and `/setup` redirect to `/`. Auth code is fully preserved and the flag defaults to `"0"`.
- New startup order in `render.yaml`: `db:push --accept-data-loss` → `auth:migrate` → `db:seed-if-empty` → `next start`. All steps non-interactive and idempotent; DB is rebuilt from scratch in ~5–10 s on every cold boot.
- `seedIfEmpty()` (new export in `seed.ts`) seeds only when `COUNT(*) FROM invoices = 0`; never reseeds a populated DB. Backed by `scripts/seed-if-empty.ts` and `pnpm db:seed-if-empty`. `pnpm db:seed` (destructive full-reseed) is unchanged.
- `RENDER_SETUP.md` updated: removed incorrect "add a persistent disk on Free" advice (persistent disks are a paid Render feature, not available on Free).
- Tests: `env.test.ts` covers `DEMO_PUBLIC` parsing; `demo-public.test.ts` covers both modes; `seed.test.ts` covers `seedIfEmpty`; `deployment.test.ts` is a startup-order regression test.

**D57. PayPal event delivery, shared reconciliation, and demo controls.** The official [event catalog](https://developer.paypal.com/api/rest/webhooks/event-names/) confirms `INVOICING.INVOICE.PAID` (including partial and pending payments), `CANCELLED`, `REFUNDED`, `CREATED`, `UPDATED`, and `SCHEDULED`. It omits `SENT`, which the [Invoicing guide](https://developer.paypal.com/api/invoicing/webhooks/) lists, so the listener accepts it if delivered. PayPal verifies Sandbox notifications via [verify-webhook-signature](https://developer.paypal.com/api/webhooks/v1/verify-webhook-signature-post) using the original event and transmission headers. The mock header works only in mock mode.

The listener records only identifiers, dedupes before scheduling background work, and shares authoritative reconciliation with polling and simulated payments. Installment rows track progress. The original stays `SUPERSEDED` when its chase state and plan become `RESOLVED`, preserving D6. Refunds reduce net paid cents and reopen a resolved plan if an installment is no longer paid. Public demo routes retain the workspace access gate when enabled, and reset stays mock-only to preserve Sandbox invoice links. Polling starts lazily after database startup. D56's invalid Drizzle flag was removed to match the verified Render commands.

**D58. Sandbox invoicing verified.** Sandbox rejected `DUE_ON_DATE` with HTTP 400. Use PayPal's documented `DUE_ON_DATE_SPECIFIED` enum with the due date from docs/05. The successful HTTP 201 create response supplied a top-level `href` with the `INV2-` ID. Extract the ID and retrieve the invoice through the configured Sandbox host. This replaces the create-response assumption in D34 and the mock-only verification in D35. The verified smoke run captured GET responses in `DRAFT` and, immediately after send, `SCHEDULED` (mapped to `SENT`). Both included a recipient URL. The contract fixtures retain only fields used by the mapper, with invoice identifiers and recipient URLs replaced.

**D59. Durable SQLite and repeatable public Sandbox demos on Render Free.** With both Turso settings present, Chaser uses one persistent SQLite database for its workspace and Better Auth. The native libSQL driver supports the existing synchronous transactions. Local development can still use `DATABASE_PATH`. Startup skips seeding if any business table contains rows, including when invoices is empty. Auth rows do not affect that check.

With `DEMO_PUBLIC=1`, the dashboard reset replaces only the fictional business tables in one transaction and preserves all auth tables. This supersedes D57's mock-only reset for public deployments. The direct seed command retains its hosted database guard. Public demo actions share a per-process mutation lock and action cooldowns, with 10 seconds between resets. Public production polling still starts lazily on the first workspace read and repeats every 10 seconds.

Sandbox reset records the PayPal IDs of locally linked installments before replacing the demo data. After the response, it checks PayPal for their current balances and attempts to cancel only unpaid, open invoices. Failures are audited without interrupting reset, and paid invoices are left in PayPal. Sandbox installment numbers include a stable per-plan suffix because PayPal retains invoice numbers across walkthroughs. The Singapore Render Blueprint declares public Sandbox mode and receives Turso and PayPal settings from deployment configuration.

**D60. Agent evals exercise the real guardrails in an isolated workspace.** Each scenario gets a fresh in-memory SQLite database and mock PayPal. Scripted probes submit invalid tool inputs and verify the resulting audit entries. Live repeats use the configured provider for classification and the agent loop, with no scripted fallback. The Priya and Elena scenarios supply explicit owner decisions as fixtures because the approval page has no decision control.

The evals exposed raw client text in tool history, cross-invoice tool access, unsafe outgoing text and leaked instructions, invalid or duplicate installment inputs, and a plan horizon check that depended on array order. They also exposed a missed scripted acceptance for Elena and a client reply that could overwrite an active plan’s chase state. The runner now scopes tool calls to its invoice, wraps client history, and suppresses leaked instructions in summaries. Tool validation, policy checks, and reply classification enforce the affected constraints. Active-plan retries record an audit entry linked to the original invoice.

**D61. The guided demo includes its documented approval example.** Priya’s scripted dispute uses the same demo route as Dana. The fixed goodwill counter is available only for the seeded Priya invoice with a pending discount request and a policy that allows 5%. The owner decision and relayed message are audited. Render serves the first loading page while the process wakes, and Next shows a friendly loading state once Chaser can respond.

**D62. Correlate late PayPal cancellations across public demo resets.** Reset removes the old business invoice links before best-effort cancellation runs, so a delayed Sandbox cancellation webhook no longer has a local invoice row. Keep a 30-day, bounded PayPal invoice ID correlation map in the existing `kv` table across demo resets. A matching `INVOICING.INVOICE.CANCELLED` event is recorded as an expected demo-reset cancellation; other unmatched events remain visible as warnings. The Audit page shows the event type and provider invoice ID so an unmatched delivery has useful context.
