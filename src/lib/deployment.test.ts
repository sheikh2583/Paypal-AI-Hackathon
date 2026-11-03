import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("production deployment commands", () => {
  const renderConfig = readFileSync(path.join(process.cwd(), "render.yaml"), "utf8");
  const packageJson = JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };

  it("starts without running schema push or the destructive demo seed", () => {
    const startCommand = renderConfig.match(/^\s+startCommand:\s*(.+)$/m)?.[1];
    expect(startCommand).toBeDefined();
    expect(startCommand).toMatch(/auth:migrate/);
    expect(startCommand).toMatch(/pnpm@10\.28\.0 start/);
    expect(startCommand).not.toMatch(/\bdb:/);
  });

  it("keeps the demo seed as an explicit manual command", () => {
    expect(packageJson.scripts["db:seed"]).toBe("tsx --env-file-if-exists=.env.local src/lib/db/seed.ts");
  });
});
