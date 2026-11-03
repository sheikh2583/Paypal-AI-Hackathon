import { ensureAuthSchema } from "../src/lib/auth";

async function main() {
  await ensureAuthSchema();
  console.log("Better Auth schema is ready.");
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Better Auth schema migration failed.");
  process.exitCode = 1;
});
