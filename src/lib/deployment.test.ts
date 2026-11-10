import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("production deployment commands", () => {
  const renderConfig = readFileSync(path.join(process.cwd(), "render.yaml"), "utf8");
  const packageJson = JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };

  // ---------------------------------------------------------------------------
  // Startup-order regression (D56)
  // ---------------------------------------------------------------------------

  it("startup sequence: db:push then auth:migrate then seed-if-empty then start (D56)", () => {
    const startCommand = renderConfig.match(/^\s+startCommand:\s*(.+)$/m)?.[1] ?? "";
    expect(startCommand).toBeTruthy();

    // All four phases must appear
    expect(startCommand).toMatch(/db:push/);
    expect(startCommand).toMatch(/auth:migrate/);
    expect(startCommand).toMatch(/db:seed-if-empty/);
    expect(startCommand).toMatch(/pnpm@10\.28\.0 start/);

    // Order: push < migrate < seed-if-empty < start
    const pushIdx         = startCommand.indexOf("db:push");
    const migrateIdx      = startCommand.indexOf("auth:migrate");
    const seedIfEmptyIdx  = startCommand.indexOf("db:seed-if-empty");
    const startIdx        = startCommand.lastIndexOf("start");
    expect(pushIdx).toBeLessThan(migrateIdx);
    expect(migrateIdx).toBeLessThan(seedIfEmptyIdx);
    expect(seedIfEmptyIdx).toBeLessThan(startIdx);
  });

  it("does not pass unsupported or destructive options to Drizzle on startup", () => {
    const startCommand = renderConfig.match(/^\s+startCommand:\s*(.+)$/m)?.[1] ?? "";
    expect(startCommand).toMatch(/db:push &&/);
    expect(startCommand).not.toMatch(/--accept-data-loss|--force/);
  });

  it("declares the public Singapore Sandbox deployment without committing credentials (D59)", () => {
    expect(renderConfig).toMatch(/^    region: singapore$/m);
    expect(renderConfig).toMatch(/- key: DEMO_PUBLIC\r?\n +value: "1"$/m);
    expect(renderConfig).toMatch(/- key: PAYPAL_MODE\r?\n +value: sandbox$/m);
    for (const key of ["TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN", "PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET",
      "PAYPAL_SANDBOX_MERCHANT_EMAIL", "PAYPAL_SANDBOX_BUYER_EMAIL", "PAYPAL_WEBHOOK_ID"]) {
      expect(renderConfig).toMatch(new RegExp(`- key: ${key}\\r?\\n +sync: false$`, "m"));
    }
  });

  it("keeps the demo seed as an explicit manual command", () => {
    expect(packageJson.scripts["db:seed"]).toBe("tsx --env-file-if-exists=.env.local src/lib/db/seed.ts");
  });

  it("provides db:seed-if-empty as a non-destructive startup seed command", () => {
    expect(packageJson.scripts["db:seed-if-empty"]).toBe("tsx --env-file-if-exists=.env.local scripts/seed-if-empty.ts");
  });
});
