# Render Production Setup Guide

## Critical: Persistent Disk Configuration

The application uses SQLite for data storage. Render's free tier does not persist files between deploys unless a **persistent disk** is configured.

### Required Configuration

1. **Add a Persistent Disk in Render Dashboard:**
   - Go to your service settings in Render dashboard
   - Navigate to "Disks" section
   - Click "Add Disk"
   - Set the mount path to: `/app/data`
   - Choose an appropriate size (1GB minimum recommended)

2. **Verify DATABASE_PATH Environment Variable:**
   ```
   DATABASE_PATH=./data/chaser.db
   ```
   
   This is already configured in `render.yaml`, but verify it matches in your Render dashboard.

### Without Persistent Disk

If no persistent disk is configured:
- The database will be created in the ephemeral filesystem
- All data (users, authentication sessions, invoices, etc.) will be **lost on every deploy**
- The owner account will need to be recreated after each deploy
- This is acceptable for demo/testing but **not for production use**

### Database Migration Safety

The `startCommand` in `render.yaml` runs `pnpm auth:migrate` before starting the server:

```yaml
startCommand: npx pnpm@10.28.0 auth:migrate && npx pnpm@10.28.0 start
```

This ensures:
- Better Auth schema migrations run automatically on startup
- The `rateLimit` table schema is repaired before migrations (fixes the schema mismatch error)
- Existing authentication data and application data are preserved
- Migrations are idempotent and safe to run on every deploy

### Environment Variables Required

Ensure these are set in Render dashboard (marked `sync: false` in render.yaml):

- `AUTH_OWNER_EMAIL` - Email address allowed to create the owner account
- `BETTER_AUTH_SECRET` - Secret key for Better Auth (generate with `openssl rand -base64 32`)
- `RESEND_API_KEY` - API key for Resend email service
- `ANTHROPIC_API_KEY` - API key for Claude LLM (if not using mock mode)

Optional:
- `RESEND_FROM` - Email sender address (defaults to test sender in render.yaml)

### Deployment Flow

1. Build completes successfully
2. Migrations run via `pnpm auth:migrate`:
   - Checks if `rateLimit` table exists
   - If it exists and lacks `id` column, adds it
   - Runs Better Auth migrations
   - Creates custom `auth_email_verification_tokens` table
3. Application starts with `pnpm start`
4. Navigate to `/setup` to create the owner account (first deploy only)

### Troubleshooting

**"Database schema mismatch" error:**
- Fixed in this deployment by reordering migration steps
- The `rateLimit.id` column is now added BEFORE Better Auth validates the schema

**"Owner account already exists" at /setup:**
- This is expected behavior if the owner was already created
- Use the `/login` page instead
- To reset (development only): delete the database file and redeploy

**Email verification not working:**
- Verify `RESEND_API_KEY` and `RESEND_FROM` are set
- Check Render logs for email sending errors
- Test sender (`onboarding@resend.dev`) may have delivery restrictions

**Data lost after deploy:**
- Verify persistent disk is mounted at `/app/data`
- Check that `DATABASE_PATH=./data/chaser.db` resolves to the mounted disk
- Render may require absolute path: `DATABASE_PATH=/app/data/chaser.db`
