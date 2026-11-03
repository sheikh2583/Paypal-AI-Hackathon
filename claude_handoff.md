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

## Production database safety status

The urgent production data-safety fix is being prepared on branch `codex/production-startup-data-safety`. No production database or Render settings have been changed.

1. **Startup change:** in this branch `render.yaml` is changed to run only `auth:migrate` and `start`; it no longer invokes `db:push` or `db:seed`. The explicit `pnpm db:seed` command remains available for demo setup. A regression test checks both conditions.
2. **Seed behavior:** `src/lib/db/seed.ts` deletes rows from messages, approvals, audit logs, webhook events, mock PayPal invoices, plans, invoices, clients, owner policy, and KV before reseeding. Never run it against production.
3. **Persistence:** the Render blueprint says `plan: free`, declares no disk, and sets `DATABASE_PATH=./data/chaser.db`. Current Render docs say Free web services cannot attach persistent disks and have ephemeral filesystems; therefore this configuration does not provide durable SQLite storage. Durable storage needs a paid service with a persistent disk mounted at an absolute path that matches the resolved DB path, or a managed database. Any Render plan/resource change is a manual owner action.
4. **Migrations:** `db:push` remains for local development only. There is no checked-in Drizzle migration history for business tables. Use versioned, reviewed migrations for future production schema changes, after establishing a safe baseline for the existing deployed DB. Do not guess a baseline or apply migrations to production as part of this task. Better Auth's `auth:migrate` remains in startup and should continue to be reviewed for additive behavior.
5. **Production auth configuration:** expected names are `APP_BASE_URL`, `AUTH_OWNER_EMAIL`, `BETTER_AUTH_SECRET` (stable, random, at least 32 characters), `RESEND_API_KEY`, `RESEND_FROM`. The deployment base URL is `https://paypal-ai-hackathon-9tkr.onrender.com`. Never print secret values. Make the production secret mandatory and stable. `onboarding@resend.dev` is a restricted test sender; no custom domain is owned.
6. **Deployment is not approved.** Do not deploy, alter Render resources, or mutate production data.

Last safe live probe (an empty POST to sign-in; it could not send email) returned HTTP 503 with the old message naming `AUTH_EMAIL_FROM`. That indicates the public service was still serving the old auth build at that time. No real Resend delivery has been tested. Recheck only with non-destructive requests after the owner deploys.

## Latest local validation

At commit `1f05643`, before this follow-up, these passed:

- `pnpm db:push` — no local changes detected; non-interactive.
- `pnpm auth:migrate` — Better Auth schema ready.
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test` — 281 passed, 1 skipped (282 total).
- `pnpm build` — successful, no Better Auth schema warnings after local additive migration.

Rerun checks after the deployment-safety change. Passing local checks does not verify live email delivery, Render storage, or production deploy behavior. Do not run `pnpm db:seed` against production.

## Useful paths

- Auth: `src/lib/auth.ts`, `src/lib/auth-email.ts`, `src/lib/auth-tokens.ts`, `src/app/api/auth/[...all]/route.ts`, auth pages/components under `src/app/` and `src/components/`.
- Env: `src/lib/env.ts`, `.env.example`.
- DB: `src/lib/db/client.ts`, `schema.ts`, `queries.ts`, `seed.ts`, `seed.test.ts`; Drizzle config: `drizzle.config.ts`.
- Deployment: `render.yaml`, package scripts in `package.json`, regression test `src/lib/deployment.test.ts`.
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

Inspect `git diff --check`, `git diff`, and `git status` before committing. The current branch is `codex/production-startup-data-safety`; make small, focused commits. Never include `.env.local`, `data/*.db`, `node_modules`, `.next`, provider keys, session tokens, or production database contents in a share archive or commit.
