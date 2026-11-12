/**
 * Creates sign-ins for clients (D77). The owner runs this; clients never sign up themselves.
 *
 *   CLIENT_ACCOUNTS=client-dana=dana@example.com,client-priya=priya@example.com   (in .env.local)
 *   pnpm clients:accounts                    create missing accounts, keep existing passwords
 *   pnpm clients:accounts --reset-passwords  give every listed account a new password
 *
 * Accounts are created already verified, because Resend's testing sender cannot deliver
 * verification mail to these addresses. New passwords are written only to the gitignored
 * client-accounts.local.md; nothing secret is printed.
 */
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";

function password(): string {
  // 20 characters from a 32-letter alphabet, grouped for reading: about 100 bits.
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789AB";
  const bytes = randomBytes(20);
  const chars = [...bytes].map((byte) => alphabet[byte % 32]);
  return [0, 5, 10, 15].map((start) => chars.slice(start, start + 5).join("")).join("-");
}

/**
 * `pnpm clients:accounts --demo` creates (or repairs) the public demo sign-ins from
 * src/lib/demo-accounts.ts with their fixed, published passwords (D78).
 */
async function ensureDemoAccounts(): Promise<void> {
  const { DEMO_CLIENT_ACCOUNTS } = await import("../src/lib/demo-accounts");
  const { auth, ensureAuthSchema } = await import("../src/lib/auth");
  const { db } = await import("../src/lib/db/client");
  await ensureAuthSchema();
  db.$client.exec("CREATE TABLE IF NOT EXISTS client_accounts (email text PRIMARY KEY, client_id text NOT NULL, created_at text NOT NULL)");
  const context = await auth.$context;
  for (const account of DEMO_CLIENT_ACCOUNTS) {
    const hash = await context.password.hash(account.password);
    const existing = await context.internalAdapter.findUserByEmail(account.email, { includeAccounts: true });
    if (!existing) {
      const user = await context.internalAdapter.createUser({ email: account.email, name: `${account.name} (demo)`, emailVerified: true }, { method: "admin" });
      await context.internalAdapter.linkAccount({ userId: user.id, providerId: "credential", accountId: user.id, password: hash });
    } else {
      // Put the published password back in case anyone changed it.
      await context.internalAdapter.updatePassword(existing.user.id, hash);
      await context.internalAdapter.updateUser(existing.user.id, { emailVerified: true, twoFactorEnabled: false });
    }
    db.$client.prepare("INSERT INTO client_accounts (email, client_id, created_at) VALUES (?, ?, ?) ON CONFLICT(email) DO UPDATE SET client_id = excluded.client_id").run(account.email, account.clientId, new Date().toISOString());
    const signedIn = await auth.api.signInEmail({ body: { email: account.email, password: account.password } }).then(() => true).catch(() => false);
    console.log(`${account.name} demo sign-in: ${existing ? "repaired" : "created"}, sign-in check ${signedIn ? "passed" : "FAILED"}.`);
  }
}

async function main(): Promise<void> {
  if (process.argv.includes("--demo")) { await ensureDemoAccounts(); return; }
  const reset = process.argv.includes("--reset-passwords");
  const pairs = (process.env.CLIENT_ACCOUNTS ?? "").split(",").map((item) => item.trim()).filter(Boolean).map((item) => {
    const [clientId, email] = item.split("=").map((part) => part?.trim() ?? "");
    return { clientId, email: email.toLowerCase() };
  });
  if (pairs.length === 0 || pairs.some(({ clientId, email }) => !clientId || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))) {
    console.log("Set CLIENT_ACCOUNTS in .env.local, e.g. client-dana=dana@example.com,client-priya=priya@example.com");
    process.exitCode = 1;
    return;
  }

  const { auth, ensureAuthSchema } = await import("../src/lib/auth");
  const { db } = await import("../src/lib/db/client");
  const { getClient } = await import("../src/lib/db/queries");
  const { getAuthEnv } = await import("../src/lib/env");
  await ensureAuthSchema();
  db.$client.exec("CREATE TABLE IF NOT EXISTS client_accounts (email text PRIMARY KEY, client_id text NOT NULL, created_at text NOT NULL)");
  const context = await auth.$context;
  const ownerEmail = getAuthEnv().ownerEmail;
  const lines: string[] = [];
  const now = new Date().toISOString();

  for (const { clientId, email } of pairs) {
    const client = getClient(clientId, db);
    if (!client) { console.log(`${clientId}: no such client, skipped.`); continue; }
    if (email === ownerEmail) { console.log(`${client.name}: that is the owner's email, skipped.`); continue; }
    const existing = await context.internalAdapter.findUserByEmail(email, { includeAccounts: true });
    if (existing && (existing.user as { twoFactorEnabled?: boolean }).twoFactorEnabled) {
      console.log(`${client.name}: that email belongs to an account with two-step sign-in (likely the owner), skipped.`);
      continue;
    }
    let newPassword: string | null = null;
    if (!existing) {
      newPassword = password();
      const hash = await context.password.hash(newPassword);
      const user = await context.internalAdapter.createUser({ email, name: client.name, emailVerified: true }, { method: "admin" });
      await context.internalAdapter.linkAccount({ userId: user.id, providerId: "credential", accountId: user.id, password: hash });
      console.log(`${client.name}: account created.`);
    } else if (reset) {
      newPassword = password();
      await context.internalAdapter.updatePassword(existing.user.id, await context.password.hash(newPassword));
      await context.internalAdapter.updateUser(existing.user.id, { emailVerified: true });
      console.log(`${client.name}: password reset.`);
    } else {
      console.log(`${client.name}: account already exists, password unchanged.`);
    }
    db.$client.prepare("INSERT INTO client_accounts (email, client_id, created_at) VALUES (?, ?, ?) ON CONFLICT(email) DO UPDATE SET client_id = excluded.client_id").run(email, clientId, now);

    // Prove the password works through the same sign-in the client page uses.
    if (newPassword) {
      const signedIn = await auth.api.signInEmail({ body: { email, password: newPassword } }).then(() => true).catch(() => false);
      console.log(`${client.name}: sign-in check ${signedIn ? "passed" : "FAILED"}.`);
    }
    lines.push(`| ${client.name} | ${email} | ${newPassword ?? "(unchanged; rerun with --reset-passwords to replace)"} |`);
  }

  // CLIENT_ACCOUNTS_FILE lets a local test write elsewhere instead of overwriting the real list.
  const outputFile = process.env.CLIENT_ACCOUNTS_FILE || "client-accounts.local.md";
  writeFileSync(outputFile, [
    "# Chaser client sign-ins (local only, gitignored; never commit)",
    "",
    `Created ${now}. Sign in at /client/login on the hosted demo.`,
    "",
    "| Client | Email | Password |",
    "|---|---|---|",
    ...lines,
    "",
  ].join("\n"));
  console.log(`Wrote ${outputFile}. Passwords are not printed here.`);
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Client account setup failed.");
  process.exitCode = 1;
});
