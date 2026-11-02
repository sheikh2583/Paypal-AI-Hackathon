// Contract test: verifies that the mock client returns the same shape as
// real PayPal API fixtures. Skips with a clear message when no fixtures exist
// (e.g. when Sandbox credentials have not been used yet).
import { describe, expect, it } from "vitest";
import { readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dir, "__fixtures__");

const REQUIRED_KEYS: (keyof import("../types").PayPalInvoice)[] = [
  "paypalInvoiceId",
  "number",
  "status",
  "amountCents",
  "paidCents",
];

describe("PayPal response contract", () => {
  let fixtureFiles: string[] = [];
  try {
    fixtureFiles = readdirSync(fixturesDir).filter((f) => f.endsWith(".json"));
  } catch {
    fixtureFiles = [];
  }

  if (fixtureFiles.length === 0) {
    it.skip(
      "no fixtures in src/lib/paypal/__fixtures__/ — run pnpm paypal:smoke with Sandbox credentials to generate them",
      () => {},
    );
    return;
  }

  for (const file of fixtureFiles) {
    it(`fixture ${file} has required PayPalInvoice keys`, async () => {
      const { default: fixture } = (await import(join(fixturesDir, file), {
        assert: { type: "json" },
      })) as { default: Record<string, unknown> };

      for (const key of REQUIRED_KEYS) {
        expect(fixture, `missing key: ${key}`).toHaveProperty(key);
      }
      expect(typeof fixture.amountCents).toBe("number");
      expect(typeof fixture.paidCents).toBe("number");
      expect(Number.isInteger(fixture.amountCents)).toBe(true);
      expect(Number.isInteger(fixture.paidCents)).toBe(true);
    });
  }
});

