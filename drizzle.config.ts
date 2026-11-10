import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { defineConfig } from "drizzle-kit";
import { getDatabaseEnv } from "./src/lib/env";

const envLocal = path.resolve(process.cwd(), ".env.local");
if (existsSync(envLocal)) process.loadEnvFile(envLocal);

function getDatabaseConfig() {
  const settings = getDatabaseEnv();
  if (settings.mode === "turso") {
    return { dialect: "turso" as const, dbCredentials: { url: settings.url, authToken: settings.authToken } };
  }
  const localPath = path.resolve(settings.path);
  mkdirSync(path.dirname(localPath), { recursive: true });
  return { dialect: "sqlite" as const, dbCredentials: { url: pathToFileURL(localPath).href } };
}

export default defineConfig({
  ...getDatabaseConfig(),
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
});
