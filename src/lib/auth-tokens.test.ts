import BetterSqlite3 from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { consumeEmailVerificationToken, ensureAuthTokenSchema, ensureRateLimitIdColumn, hashAuthToken, hashEmailOtp, resetPasswordIdentifier, storeEmailVerificationToken } from "./auth-tokens";

describe("auth token storage", () => {
  const databases: BetterSqlite3.Database[] = [];
  function openDatabase() {
    const database = new BetterSqlite3(":memory:");
    databases.push(database);
    return database;
  }
  afterEach(() => { for (const database of databases.splice(0)) database.close(); });

  it("stores only token hashes and consumes verification links once", () => {
    const database = openDatabase();
    ensureAuthTokenSchema(database);
    const token = "a-signed-verification-token";
    const now = new Date("2026-11-03T10:00:00.000Z");
    storeEmailVerificationToken(database, token, new Date("2026-11-04T10:00:00.000Z"));
    const row = database.prepare("SELECT token_hash FROM auth_email_verification_tokens").get() as { token_hash: string };
    expect(row.token_hash).toBe(hashAuthToken(token));
    expect(row.token_hash).not.toContain(token);
    expect(consumeEmailVerificationToken(database, token, now)).toBe(true);
    expect(consumeEmailVerificationToken(database, token, now)).toBe(false);
  });

  it("rejects expired tokens and hashes reset-token identifiers", () => {
    const database = openDatabase();
    ensureAuthTokenSchema(database);
    const token = "expired-token";
    storeEmailVerificationToken(database, token, new Date("2026-11-03T09:59:59.000Z"));
    expect(consumeEmailVerificationToken(database, token, new Date("2026-11-03T10:00:00.000Z"))).toBe(false);
    const identifier = resetPasswordIdentifier(token);
    expect(identifier).toMatch(/^reset-password:[a-f0-9]{64}$/);
    expect(identifier).not.toContain(token);
  });

  it("HMAC-hashes short OTPs with the server secret as a pepper", () => {
    const code = "123456";
    const first = hashEmailOtp(code, "secret-a");
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).not.toContain(code);
    expect(hashEmailOtp(code, "secret-b")).not.toBe(first);
  });

  it("adds the token table without deleting existing database records", () => {
    const database = openDatabase();
    database.exec("CREATE TABLE existing_data (value TEXT NOT NULL); INSERT INTO existing_data VALUES ('preserve-me')");
    ensureAuthTokenSchema(database);
    ensureAuthTokenSchema(database);
    expect(database.prepare("SELECT value FROM existing_data").get()).toEqual({ value: "preserve-me" });
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='auth_email_verification_tokens'").get()).toEqual({ name: "auth_email_verification_tokens" });
  });

  it("adds the Better Auth rate-limit id column without losing existing counters", () => {
    const database = openDatabase();
    database.exec('CREATE TABLE "rateLimit" (key TEXT UNIQUE NOT NULL, count INTEGER NOT NULL, lastRequest INTEGER NOT NULL)');
    database.prepare('INSERT INTO "rateLimit" VALUES (?, ?, ?)').run("login:test", 2, 123);
    const columns = () => database.prepare('PRAGMA table_info("rateLimit")').all() as Array<{ name: string }>;
    const addColumn = () => database.exec('ALTER TABLE "rateLimit" ADD COLUMN "id" TEXT');
    ensureRateLimitIdColumn(columns(), addColumn);
    ensureRateLimitIdColumn(columns(), addColumn);
    expect(database.prepare('PRAGMA table_info("rateLimit")').all()).toEqual(expect.arrayContaining([expect.objectContaining({ name: "id" })]));
    expect(database.prepare('SELECT key, count, lastRequest FROM "rateLimit"').get()).toEqual({ key: "login:test", count: 2, lastRequest: 123 });
  });
});
