import { afterEach, describe, expect, it, vi } from "vitest";
import { closeTestDb, createTestDb } from "./db/test-utils";
import type { AppDb } from "./db/client";
import { seedDatabase } from "./db/seed";
import { getInvoice, listApprovals, listAudit } from "./db/queries";
import { setClockDatabaseForTests, setClockOffset } from "./clock";

// A live model that reads Priya's 40% request and only sends a polite note, without escalating.
vi.mock("./llm", async (original) => {
  const actual = await original<typeof import("./llm")>();
  return {
    ...actual,
    getLLM: () => ({
      async structured<T>() { return {} as T; },
      async runToolLoop() { return { summary: "Replied to Priya.", toolCalls: [] }; },
    }),
  };
});

const NOW = new Date("2026-11-03T00:00:00.000Z");
let database: AppDb;
const saved = { ...process.env };
afterEach(() => {
  if (database) closeTestDb(database);
  setClockDatabaseForTests(undefined);
  process.env = { ...saved };
});

describe("Priya's story with a live model", () => {
  it("still sends a request above the discount cap to the owner when the model does not escalate", async () => {
    Object.assign(process.env, { DEMO_NOW: NOW.toISOString(), LLM_MODE: "live", LLM_PROVIDER: "openai-compatible", LLM_API_KEY: "test-key", LLM_BASE_URL: "https://provider.test/v1", LLM_MODEL: "test-model" });
    database = createTestDb();
    setClockDatabaseForTests(database);
    await seedDatabase(database, { paypalMode: "mock" }, NOW);
    setClockOffset(0, database);
    const { runPriyaDemoStep } = await import("./demo-priya");

    const response = await runPriyaDemoStep(getInvoice("invoice-priya-600", database)!, database, false);
    expect(response.status).toBe(200);
    const approval = listApprovals(undefined, database).find((item) => item.invoiceId === "invoice-priya-600" && item.kind === "DISCOUNT_REQUEST");
    expect(approval?.reason).toContain("above your 5% limit");
    expect(listAudit("invoice-priya-600", database).some((entry) => entry.action === "policy.discount_cap")).toBe(true);

    // A second click does not create a second request.
    await runPriyaDemoStep(getInvoice("invoice-priya-600", database)!, database, false);
    expect(listApprovals(undefined, database).filter((item) => item.invoiceId === "invoice-priya-600" && item.kind === "DISCOUNT_REQUEST")).toHaveLength(1);
  });
});
