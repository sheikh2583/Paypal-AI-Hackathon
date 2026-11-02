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
  out: "./drizzle",
  dbCredentials: { url: databasePath },
});
