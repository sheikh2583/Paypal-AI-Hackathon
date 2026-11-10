# Render Deployment Guide

## Architecture on Render Free

Render Free does **not** offer a persistent disk. Every spin-down or redeploy wipes the
ephemeral filesystem, including the SQLite file. This is intentional for the hackathon demo:

- **`DEMO_PUBLIC=1`** removes the login requirement entirely — judges browse without creating
  an account or receiving email.
- The startup sequence recreates the database from scratch on every cold boot.
- No data entered by a judge persists across restarts (demo-safe; no real user data).

## Startup Sequence (render.yaml)

```
db:push → auth:migrate → db:seed-if-empty → next start
```

| Step | Command | What it does |
|---|---|---|
| 1 | `pnpm db:push` | Creates the business schema on a fresh demo database |
| 2 | `pnpm auth:migrate` | Runs Better Auth migrations; repairs rateLimit schema |
| 3 | `pnpm db:seed-if-empty` | Seeds demo data **only** when the invoices table is empty |
| 4 | `pnpm start` | Serves the Next.js app |

These steps are safe to repeat on the unchanged demo schema. Review destructive schema changes separately.

## Environment Variables

The following are set in `render.yaml` directly:

| Variable | Value |
|---|---|
| `DEMO_PUBLIC` | `1` — bypasses auth gate for judges |
| `APP_BASE_URL` | Your Render service URL |
| `PAYPAL_MODE` | `mock` |
| `LLM_MODE` | `auto` |

The following are set in the Render dashboard (`sync: false`):

| Variable | Purpose |
|---|---|
| `AUTH_OWNER_EMAIL` | Owner email (optional when `DEMO_PUBLIC=1`) |
| `BETTER_AUTH_SECRET` | Better Auth signing secret (optional when `DEMO_PUBLIC=1`) |
| `RESEND_API_KEY` | Email delivery (not needed with `DEMO_PUBLIC=1`) |
| `ANTHROPIC_API_KEY` | Claude LLM; leave blank for scripted/offline demo mode |

> **Note:** With `DEMO_PUBLIC=1` none of the auth-related variables are required. The app
> works without them. Set them if you want to later switch off `DEMO_PUBLIC` and use real auth.

## Durable owner workspace on Render Free

1. Create a Turso SQLite database in the same region as the Render web service and issue a database-scoped read/write token.
2. Set `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` in the service's Environment tab. The existing startup sequence creates the schema and populates an empty workspace. It preserves existing invoices and webhook history on subsequent starts.
3. Keep `DEMO_PUBLIC` unset or set it to `0`. Set `AUTH_OWNER_EMAIL`, `BETTER_AUTH_SECRET`, `RESEND_API_KEY`, and `RESEND_FROM`.
4. Once the durable deployment is live, visit `/setup` to create the owner account, verify it, and sign in. Confirm `/setup` still redirects to `/login` after a redeploy.

The first Turso startup uses that database's contents. Export any existing records before a cutover if they must be transferred.

## Troubleshooting

**"Database schema mismatch" error:**
Repaired in `ensureAuthSchema()` — the `rateLimit.id` column is added *before* Better Auth
validates the schema. Fully idempotent; safe to re-run.

**Demo data missing after a restart:** Check whether `db:seed-if-empty` reported an empty workspace or skipped because invoices already exist. Check that both Turso environment keys are set on the deployed service.

**Judges see a login page:**
Ensure `DEMO_PUBLIC=1` is set in `render.yaml` and that the deploy completed successfully.
Check Render logs for any startup step failures.
