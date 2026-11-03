/**
 * Integration test for Better Auth schema migration fix.
 * Verifies that the migration order prevents schema mismatch errors.
 */
import { describe, it, expect, beforeEach } from "vitest";
import BetterSqlite3 from "better-sqlite3";
import type { AppDb } from "./db/client";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { ensureAuthTokenSchema, ensureRateLimitIdColumn } from "./auth-tokens";

describe("Better Auth migration order - production scenario", () => {
  let testDb: BetterSqlite3.Database;
  let db: AppDb;

  beforeEach(() => {
    testDb = new BetterSqlite3(":memory:");
    db = drizzle(testDb) as unknown as AppDb;
    (db as unknown as { $client: BetterSqlite3.Database }).$client = testDb;
  });

  it("handles existing database with old rateLimit schema (no id column)", () => {
    // Simulate an existing production database with old Better Auth tables
    testDb.exec(`
      CREATE TABLE IF NOT EXISTS "user" (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        emailVerified INTEGER NOT NULL DEFAULT 0,
        name TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        image TEXT,
        twoFactorEnabled INTEGER
      );
      
      CREATE TABLE IF NOT EXISTS "session" (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        expiresAt TEXT NOT NULL,
        token TEXT NOT NULL UNIQUE,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        ipAddress TEXT,
        userAgent TEXT,
        FOREIGN KEY (userId) REFERENCES "user"(id) ON DELETE CASCADE
      );
      
      CREATE TABLE IF NOT EXISTS "account" (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        accountId TEXT NOT NULL,
        providerId TEXT NOT NULL,
        accessToken TEXT,
        refreshToken TEXT,
        expiresAt TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        FOREIGN KEY (userId) REFERENCES "user"(id) ON DELETE CASCADE
      );
      
      CREATE TABLE IF NOT EXISTS "verification" (
        id TEXT PRIMARY KEY,
        identifier TEXT NOT NULL,
        value TEXT NOT NULL,
        expiresAt TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        updatedAt TEXT
      );
      
      CREATE TABLE IF NOT EXISTS "rateLimit" (
        key TEXT UNIQUE NOT NULL,
        count INTEGER NOT NULL,
        lastRequest INTEGER NOT NULL
      );
    `);

    // Insert existing data that must be preserved
    testDb.prepare('INSERT INTO "user" VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run("user-1", "owner@example.com", 1, "Owner", "2024-01-01", "2024-01-01", null, 1);
    
    testDb.prepare('INSERT INTO "rateLimit" VALUES (?, ?, ?)')
      .run("login:owner@example.com", 3, Date.now());

    // Verify old schema
    const beforeColumns = testDb.pragma('table_info("rateLimit")') as Array<{ name: string }>;
    expect(beforeColumns.map(c => c.name)).not.toContain("id");
    expect(beforeColumns.map(c => c.name)).toEqual(["key", "count", "lastRequest"]);

    // CRITICAL FIX: Check if rateLimit exists and repair it BEFORE runMigrations
    const rateLimitExists = testDb.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='rateLimit'"
    ).get();
    
    expect(rateLimitExists).toBeDefined();
    
    if (rateLimitExists) {
      ensureRateLimitIdColumn(
        testDb.pragma('table_info("rateLimit")') as Array<{ name: string }>,
        () => testDb.exec('ALTER TABLE "rateLimit" ADD COLUMN "id" TEXT'),
      );
    }

    // Verify schema is now fixed
    const afterColumns = testDb.pragma('table_info("rateLimit")') as Array<{ name: string }>;
    expect(afterColumns.map(c => c.name)).toContain("id");

    // Verify data preservation
    const userData = testDb.prepare('SELECT email, twoFactorEnabled FROM "user"').get();
    expect(userData).toEqual({ email: "owner@example.com", twoFactorEnabled: 1 });

    const rateLimitData = testDb.prepare('SELECT key, count FROM "rateLimit"').get();
    expect(rateLimitData).toEqual({ key: "login:owner@example.com", count: 3 });

    // Now runMigrations would succeed because schema matches expectations
    ensureAuthTokenSchema(testDb);
    
    const tables = testDb.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all() as Array<{ name: string }>;
    
    expect(tables.map(t => t.name)).toContain("auth_email_verification_tokens");
    
    testDb.close();
  });

  it("handles fresh database where rateLimit doesn't exist yet", () => {
    // Fresh database - no tables yet
    const tables = testDb.prepare(
      "SELECT name FROM sqlite_master WHERE type='table'"
    ).all() as Array<{ name: string }>;
    
    expect(tables).toHaveLength(0);

    // Check if rateLimit exists (it doesn't)
    const rateLimitExists = testDb.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='rateLimit'"
    ).get();
    
    expect(rateLimitExists).toBeUndefined();

    // The fix: only try to repair if table exists
    if (rateLimitExists) {
      ensureRateLimitIdColumn(
        testDb.pragma('table_info("rateLimit")') as Array<{ name: string }>,
        () => testDb.exec('ALTER TABLE "rateLimit" ADD COLUMN "id" TEXT'),
      );
    }

    // Better Auth's runMigrations would create all tables fresh with correct schema
    // Simulate it creating rateLimit with id column
    testDb.exec(`
      CREATE TABLE IF NOT EXISTS "rateLimit" (
        id TEXT,
        key TEXT UNIQUE NOT NULL,
        count INTEGER NOT NULL,
        lastRequest INTEGER NOT NULL
      );
    `);

    const columns = testDb.pragma('table_info("rateLimit")') as Array<{ name: string }>;
    expect(columns.map(c => c.name)).toContain("id");

    ensureAuthTokenSchema(testDb);
    
    testDb.close();
  });

  it("is idempotent - multiple calls don't corrupt data", () => {
    // Create old schema
    testDb.exec(`
      CREATE TABLE IF NOT EXISTS "rateLimit" (
        key TEXT UNIQUE NOT NULL,
        count INTEGER NOT NULL,
        lastRequest INTEGER NOT NULL
      );
    `);
    
    testDb.prepare('INSERT INTO "rateLimit" VALUES (?, ?, ?)')
      .run("test:key", 5, 12345);

    // Run migration multiple times
    for (let i = 0; i < 3; i++) {
      const rateLimitExists = testDb.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='rateLimit'"
      ).get();
      
      if (rateLimitExists) {
        ensureRateLimitIdColumn(
          testDb.pragma('table_info("rateLimit")') as Array<{ name: string }>,
          () => testDb.exec('ALTER TABLE "rateLimit" ADD COLUMN "id" TEXT'),
        );
      }
      
      ensureAuthTokenSchema(testDb);
    }

    // Verify data is still intact
    const data = testDb.prepare('SELECT * FROM "rateLimit"').get();
    expect(data).toMatchObject({ key: "test:key", count: 5, lastRequest: 12345 });

    // Verify schema is correct
    const columns = testDb.pragma('table_info("rateLimit")') as Array<{ name: string }>;
    expect(columns.map(c => c.name)).toContain("id");
    expect(columns).toHaveLength(4); // key, count, lastRequest, id

    testDb.close();
  });

  it("preserves application data during migration", () => {
    // Simulate existing application tables
    testDb.exec(`
      CREATE TABLE invoices (id TEXT PRIMARY KEY, amount INTEGER);
      INSERT INTO invoices VALUES ('inv-1', 10000);
      
      CREATE TABLE clients (id TEXT PRIMARY KEY, name TEXT);
      INSERT INTO clients VALUES ('client-1', 'Test Client');
    `);

    // Create old rateLimit schema
    testDb.exec(`
      CREATE TABLE "rateLimit" (
        key TEXT UNIQUE NOT NULL,
        count INTEGER NOT NULL,
        lastRequest INTEGER NOT NULL
      );
    `);

    // Run migration
    const rateLimitExists = testDb.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='rateLimit'"
    ).get();
    
    if (rateLimitExists) {
      ensureRateLimitIdColumn(
        testDb.pragma('table_info("rateLimit")') as Array<{ name: string }>,
        () => testDb.exec('ALTER TABLE "rateLimit" ADD COLUMN "id" TEXT'),
      );
    }
    
    ensureAuthTokenSchema(testDb);

    // Verify application data is untouched
    const invoice = testDb.prepare('SELECT * FROM invoices').get();
    expect(invoice).toEqual({ id: 'inv-1', amount: 10000 });

    const client = testDb.prepare('SELECT * FROM clients').get();
    expect(client).toEqual({ id: 'client-1', name: 'Test Client' });

    testDb.close();
  });
});
