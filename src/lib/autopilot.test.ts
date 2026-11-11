import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppDb } from "./db/client";
import { listAudit, updateInvoice } from "./db/queries";
import { seedDatabase } from "./db/seed";
import { closeTestDb, createTestDb } from "./db/test-utils";
import { setClockDatabaseForTests, setClockOffset } from "./clock";

const mocks = vi.hoisted(() => ({ runAgent: vi.fn() }));
vi.mock("./agent/run", () => ({ runAgent: mocks.runAgent }));

import { getAutopilotStatus, isAutopilotEnabled, listDueInvoices, runAutopilot, setAutopilotEnabled } from "./autopilot";

const DEMO_NOW = new Date("2026-11-03T00:00:00.000Z");
const originalDemoNow = process.env.DEMO_NOW;
let database: AppDb;

beforeEach(async () => {
  process.env.DEMO_NOW = DEMO_NOW.toISOString();
  database = createTestDb();
  setClockDatabaseForTests(database);
  await seedDatabase(database, { paypalMode: "mock" }, DEMO_NOW);
  setClockOffset(0, database);
  // Two invoices are due for a follow-up now; one is scheduled for next week and must be skipped.
  updateInvoice("invoice-dana-900", { nextFollowupAt: new Date(DEMO_NOW.getTime() - 60_000).toISOString() }, database);
  updateInvoice("invoice-marcus-1250", { nextFollowupAt: DEMO_NOW.toISOString() }, database);
  updateInvoice("invoice-elena-2400", { nextFollowupAt: new Date(DEMO_NOW.getTime() + 7 * 86_400_000).toISOString() }, database);
  mocks.runAgent.mockReset();
  mocks.runAgent.mockImplementation(async (invoiceId: string) => ({ runId: "r", finalState: "NUDGED", summary: `Nudged ${invoiceId}.`, toolCalls: [] }));
});

afterEach(() => {
  setClockDatabaseForTests(undefined);
  closeTestDb(database);
  if (originalDemoNow === undefined) delete process.env.DEMO_NOW; else process.env.DEMO_NOW = originalDemoNow;
});

describe("autopilot", () => {
  it("is off by default and the switch is persisted and audited", () => {
    expect(isAutopilotEnabled(database)).toBe(false);
    setAutopilotEnabled(true, database);
    expect(getAutopilotStatus(database)).toMatchObject({ enabled: true, lastRun: null, intervalMinutes: 30 });
    expect(listAudit(undefined, database).some((entry) => entry.action === "autopilot.toggle" && entry.actor === "owner")).toBe(true);
  });

  it("does nothing on a scheduled trigger while off, but a manual sweep still runs", async () => {
    const due = listDueInvoices(database).map(({ id }) => id);
    expect(due).toEqual(expect.arrayContaining(["invoice-dana-900", "invoice-marcus-1250"]));
    expect(due).not.toContain("invoice-elena-2400");
    await expect(runAutopilot("schedule", { database })).resolves.toMatchObject({ ran: false, reason: "autopilot_off", dueCount: due.length });
    expect(mocks.runAgent).not.toHaveBeenCalled();
    const manual = await runAutopilot("manual", { database, sleep: async () => {} });
    expect(manual.ran).toBe(true);
    expect(mocks.runAgent.mock.calls.map(([id]) => id)).toEqual(due);
    expect(getAutopilotStatus(database).lastRun).toMatchObject({ trigger: "manual", dueCount: due.length, ranCount: due.length, failedCount: 0 });
  });

  it("runs scheduled sweeps when on, continues past a failing invoice, and audits the outcome", async () => {
    setAutopilotEnabled(true, database);
    mocks.runAgent.mockImplementationOnce(async () => { throw new Error("AGENT_RUN_TIMEOUT"); });
    const result = await runAutopilot("schedule", { database, sleep: async () => {} });
    expect(result.ran).toBe(true);
    expect(result.failed).toEqual([{ invoiceId: listDueInvoices(database)[0]?.id, code: "AGENT_RUN_TIMEOUT" }]);
    expect(result.results).toHaveLength(result.dueCount - 1);
    const entry = listAudit(undefined, database).find((row) => row.action === "autopilot.run");
    expect(entry?.actor).toBe("system");
    expect(entry?.result).toMatchObject({ ranCount: result.dueCount - 1, failedCount: 1 });
  });
});
