# Render Deployment Guide

## Architecture on Render Free

Render Free does **not** offer a persistent disk. Every spin-down or redeploy wipes the
ephemeral filesystem, including the SQLite file. This is intentional for the hackathon demo:

- **`DEMO_PUBLIC=1`** removes the login requirement entirely — judges browse without creating
  an account or receiving email.
- The startup sequence recreates the database from scratch on every cold boot in ~5–10 s.
- No data entered by a judge persists across restarts (demo-safe; no real user data).

## Startup Sequence (render.yaml)

```
db:push → auth:migrate → db:seed-if-empty → next start
```

| Step | Command | What it does |
|---|---|---|
| 1 | `pnpm db:push --accept-data-loss` | Creates/updates the business schema (idempotent) |
| 2 | `pnpm auth:migrate` | Runs Better Auth migrations; repairs rateLimit schema |
| 3 | `pnpm db:seed-if-empty` | Seeds demo data **only** when the invoices table is empty |
| 4 | `pnpm start` | Serves the Next.js app |

All steps are non-interactive and safe to repeat.

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

## Turning off DEMO_PUBLIC (post-hackathon)

1. Remove `DEMO_PUBLIC=1` from `render.yaml` (or set to `0`).
2. Add a persistent database (Render's managed PostgreSQL, or a Turso/Neon SQLite-over-HTTP).
3. Set `AUTH_OWNER_EMAIL`, `BETTER_AUTH_SECRET`, `RESEND_API_KEY`, and `RESEND_FROM`.
4. Navigate to `/setup` to create the owner account.

> **Do not add a "persistent disk" on Render Free.** Persistent disks are a paid Render
> feature and are not available on the free plan. The demo is designed to work without one.

## Troubleshooting

**"Database schema mismatch" error:**
Repaired in `ensureAuthSchema()` — the `rateLimit.id` column is added *before* Better Auth
validates the schema. Fully idempotent; safe to re-run.

**Demo data missing after a restart:**
`db:seed-if-empty` runs on every startup. If it reports "already has data" unexpectedly,
`pnpm db:seed` (the destructive full-reseed) can be run manually via Render's shell.

**Judges see a login page:**
Ensure `DEMO_PUBLIC=1` is set in `render.yaml` and that the deploy completed successfully.
Check Render logs for any startup step failures.
