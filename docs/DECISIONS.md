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

**D15. Location and kit files.** Built in `/home/claude/chaser` because the session's working directory was a home folder (dotfiles, not a repo). Copied in from the Project: `AGENTS.md`, `.env.example`, `.gitignore`, `docs/02-architecture.md`, `docs/04-contracts.md`, `docs/DECISIONS.md`. Everything else in the kit (`CLAUDE.md`, `README.md`, `docs/01,03,05–08`, `prompts/`, `.cursor/`, `.github/`) was not copied; merge this tree into the real repo without overwriting those.

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
