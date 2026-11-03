/**
 * Startup seed script: seeds demo data only when the invoices table is empty.
 * Called by the Render startCommand after db:push and auth:migrate so the demo
 * DB is populated on the first boot after every ephemeral wipe, but never
 * reseeds a database that already has data.
 *
 * Usage (non-interactive, safe for CI/CD):
 *   tsx --env-file-if-exists=.env.local scripts/seed-if-empty.ts
 */
import { seedIfEmpty } from "../src/lib/db/seed";

async function main() {
  const seeded = await seedIfEmpty();
  if (!seeded) {
    console.log("Startup seed skipped — database already has data.");
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Startup seed failed.");
  process.exitCode = 1;
});
