import { createHash, createHmac } from "node:crypto";

export interface SqliteTokenDb {
  exec(sql: string): unknown;
  prepare(sql: string): {
    run(...params: (string | number)[]): { changes: number };
    get(...params: (string | number)[]): unknown;
  };
}

export function hashAuthToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function resetPasswordIdentifier(token: string): string {
  return `reset-password:${hashAuthToken(token)}`;
}

/** HMAC adds a server-side pepper because OTPs have a small search space. */
export function hashEmailOtp(token: string, secret: string): string {
  return createHmac("sha256", secret).update(token, "utf8").digest("hex");
}

/** Additive migration: does not change or delete any existing application data. */
export function ensureAuthTokenSchema(database: SqliteTokenDb): void {
  database.exec(`CREATE TABLE IF NOT EXISTS auth_email_verification_tokens (
    token_hash TEXT PRIMARY KEY NOT NULL,
    expires_at TEXT NOT NULL
  )`);
}

/**
 * Older local/deployed rate-limit tables may predate Better Auth's generated id column.
 * Better Auth 1.7+ requires the id column; this must run BEFORE context.runMigrations().
 */
export function ensureRateLimitIdColumn(columns: Array<{ name: string }>, addColumn: () => void): void {
  if (!columns.some((column) => column.name === "id")) {
    addColumn();
  }
}

export function storeEmailVerificationToken(database: SqliteTokenDb, token: string, expiresAt: Date): void {
  database.prepare(
    "INSERT INTO auth_email_verification_tokens (token_hash, expires_at) VALUES (?, ?) ON CONFLICT(token_hash) DO UPDATE SET expires_at = excluded.expires_at",
  ).run(hashAuthToken(token), expiresAt.toISOString());
  database.prepare("DELETE FROM auth_email_verification_tokens WHERE expires_at <= ?")
    .run(new Date().toISOString());
}

/** Atomically consumes an unexpired token; a concurrent or repeated call returns false. */
export function consumeEmailVerificationToken(database: SqliteTokenDb, token: string, now = new Date()): boolean {
  const result = database.prepare(
    "DELETE FROM auth_email_verification_tokens WHERE token_hash = ? AND expires_at > ?",
  ).run(hashAuthToken(token), now.toISOString());
  return result.changes === 1;
}
