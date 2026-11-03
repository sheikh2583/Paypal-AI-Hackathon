# Claude Handoff — Chaser

Updated: 2026-11-03
Repository: https://github.com/sheikh2583/Paypal-AI-Hackathon
Production URL: https://paypal-ai-hackathon-9tkr.onrender.com/
Latest pushed commit: `1f05643` (`feat: secure owner auth email flows`)

## Current request and boundary

The owner asked for a production security/deployment audit and then asked to update this handoff and create a minimal Claude Web share ZIP. The audit brief is included in this share as `PRODUCTION_SECURITY_TASK.md`.

**Do not deploy, mutate the production database, reset production data, or rotate production secrets.** The task explicitly withholds deployment approval. Work locally and prepare safe changes; stop and ask before any operation that could destroy existing records. Do not repeat or request secret values in chat.

## Project

Chaser is a single-owner AI collections demo for freelancers. It uses Next.js App Router, strict TypeScript, Better Auth, Drizzle + SQLite/better-sqlite3, Resend, and PayPal mock mode by default. Business payments and client correspondence are simulated. Money is integer cents; policy checks are enforced in code; every agent tool call is audited.

Runtime versions are pinned in `package.json`/`pnpm-lock.yaml` (Next 16.4.3, Better Auth 1.7.15, Drizzle ORM 0.45.4, Drizzle Kit 0.31.11, Vitest 5.0.5, pnpm 10.28.0). Follow `AGENTS.md` and inspect the relevant docs before code changes. This repo uses a newer Next.js version; read the installed Next guide under `node_modules/next/dist/docs/` before changing Next APIs.

## Latest auth implementation

- Resend SDK handles verification, reset, and sign-in OTP email. Configuration names are `RESEND_API_KEY` and `RESEND_FROM`; links use `APP_BASE_URL` (there is no `BETTER_AUTH_URL` or `AUTH_EMAIL_FROM` in the current source).
- First-owner signup is restricted to `AUTH_OWNER_EMAIL`; password length is 14–128; verified email and password + email OTP are required.
- Better Auth sessions are seven days; cookies are HttpOnly, SameSite=Lax, and Secure on HTTPS. Password reset revokes sessions.
- Verification links expire in 24 hours; only SHA-256 digests are stored in the additional one-time token table and consumption is atomic. Reset identifiers are hashed before Better Auth stores them. OTPs are HMAC-hashed with the auth secret, expire after five minutes, and have bounded attempts and rate limits.
- Email HTML is escaped, links must share the configured app origin, and provider failures are sanitized. UI describes the Resend testing sender restrictions without claiming arbitrary-recipient delivery.
- `pnpm auth:migrate` runs Better Auth's SQLite migrations and additive auth-support schema setup. `drizzle.config.ts` uses a table allowlist so `db:push` does not try to rename Better Auth-owned core tables. A tested additive repair adds a missing nullable `rateLimit.id` column without dropping existing counters.
- The auth implementation is not yet fully production-hardened: `src/lib/auth.ts` currently generates a random fallback secret when `BETTER_AUTH_SECRET` is missing. Production must fail closed instead of using a per-process fallback. `getAuthReadiness()` does require the configured secret before allowing auth use, but the underlying Better Auth instance still receives the fallback. Review and test this carefully.

## Critical deployment findings to handle next

These are known from source inspection, not assumptions about current Render disk state:

1. **Production startup runs the destructive demo seed.** `render.yaml` currently has `db:push && auth:migrate && db:seed && start`. `src/lib/db/seed.ts` deletes all rows from messages, approvals, audit logs, webhook events, mock PayPal invoices, plans, invoices, clients, owner policy, and KV before reseeding. Remove `db:seed` from normal production startup; keep demo seeding an explicit/manual operation. Do not run it against production.
2. **Persistence is unverified and no disk is declared in `render.yaml`.** `DATABASE_PATH` is `./data/chaser.db`. Determine whether the deployed service has persistent storage from Render configuration/dashboard or current official Render docs; do not infer that the local file survives restarts. If persistence is absent, propose a safe configuration and get approval before changing production resources.
3. **Migrations must remain additive.** Keep the Drizzle table filter and inspect every migration against existing tables/data. Do not use `--force`, destructive push, database reset, or production seed. If a migration could drop/rebuild records, stop and ask.
4. **Production auth configuration.** Expected names: `APP_BASE_URL`, `AUTH_OWNER_EMAIL`, `BETTER_AUTH_SECRET` (stable, random, at least 32 characters), `RESEND_API_KEY`, `RESEND_FROM`. The deployment base URL is `https://paypal-ai-hackathon-9tkr.onrender.com`. Do not print secret values. Validate the production secret is mandatory and stable. The Render blueprint currently declares `RESEND_FROM` as `PayPal Hackathon <onboarding@resend.dev>`; this testing sender is restricted. No custom domain is owned, so do not claim general email delivery works.
5. **Deployment is not approved.** Prepare local changes and report manual Render steps; do not deploy or mutate production.

Last safe live probe (an empty POST to sign-in; it could not send email) returned HTTP 503 with the old message naming `AUTH_EMAIL_FROM`. That indicates the public service was still serving the old auth build at that time. No real Resend delivery has been tested. Recheck only with non-destructive requests after the owner deploys.

## Latest local validation

At commit `1f05643`, these passed:

- `pnpm db:push` — no local changes detected; non-interactive.
- `pnpm auth:migrate` — Better Auth schema ready.
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test` — 281 passed, 1 skipped (282 total).
- `pnpm build` — successful, no Better Auth schema warnings after local additive migration.

These do not verify live email delivery, Render persistent storage, or production deploy behavior. Do not run `pnpm db:seed` against production.

## Useful paths

- Auth: `src/lib/auth.ts`, `src/lib/auth-email.ts`, `src/lib/auth-tokens.ts`, `src/app/api/auth/[...all]/route.ts`, auth pages/components under `src/app/` and `src/components/`.
- Env: `src/lib/env.ts`, `.env.example`.
- DB: `src/lib/db/client.ts`, `schema.ts`, `queries.ts`, `seed.ts`, `seed.test.ts`; Drizzle config: `drizzle.config.ts`.
- Deployment: `render.yaml`, package scripts in `package.json`.
- Constraints/decisions: `AGENTS.md`, `docs/DECISIONS.md`, `docs/02-architecture.md`, `docs/03-data-model.md`, `docs/04-contracts.md`, `docs/07-demo-and-submission.md`.
- Full security task: `PRODUCTION_SECURITY_TASK.md` in the Claude Web share ZIP.

## Safe workflow

Use PowerShell and run commands one at a time. Do not chain shell commands with `&&`. For work completion run:

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Inspect `git diff --check`, `git diff`, and `git status` before committing. The current branch is `main`; make small, focused commits. Never include `.env.local`, `data/*.db`, `node_modules`, `.next`, provider keys, session tokens, or production database contents in a share archive or commit.
