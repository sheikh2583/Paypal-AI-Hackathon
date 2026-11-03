import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "drizzle-kit";
import { getAppEnv } from "./src/lib/env";

const envLocal = path.resolve(process.cwd(), ".env.local");
if (existsSync(envLocal)) process.loadEnvFile(envLocal);

const databasePath = path.resolve(getAppEnv().databasePath);
mkdirSync(path.dirname(databasePath), { recursive: true });

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/lib/db/schema.ts",
  // Better Auth owns its core tables; Drizzle manages app tables plus auth-owned
  // one-time verification-token storage without diffing Better Auth-owned tables.
  tablesFilter: [
    "owner_policy",
    "clients",
    "invoices",
    "plans",
    "messages",
    "approvals",
    "audit_log",
    "webhook_events",
    "mock_paypal_invoices",
    "kv",
    "auth_email_verification_tokens",
  ],
  out: "./drizzle",
  dbCredentials: { url: databasePath },
});
