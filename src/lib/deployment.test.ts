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

  it("startCommand is non-interactive: db:push uses --accept-data-loss", () => {
    const startCommand = renderConfig.match(/^\s+startCommand:\s*(.+)$/m)?.[1] ?? "";
    expect(startCommand).toMatch(/db:push.*--accept-data-loss/);
  });

  it("DEMO_PUBLIC is set to 1 in render.yaml (D56)", () => {
    // The render.yaml must have DEMO_PUBLIC: "1" so judges need no login.
    expect(renderConfig).toMatch(/DEMO_PUBLIC/);
    expect(renderConfig).toMatch(/value:\s*["']?1["']?/);
  });

  it("keeps the demo seed as an explicit manual command", () => {
    expect(packageJson.scripts["db:seed"]).toBe("tsx --env-file-if-exists=.env.local src/lib/db/seed.ts");
  });

  it("provides db:seed-if-empty as a non-destructive startup seed command", () => {
    expect(packageJson.scripts["db:seed-if-empty"]).toBe("tsx --env-file-if-exists=.env.local scripts/seed-if-empty.ts");
  });
});
