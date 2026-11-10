import { drizzle } from "drizzle-orm/better-sqlite3";
import LibSqlite from "libsql";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppDb } from "./db/client";
import { getInvoice, getMessages, getPolicy, listApprovals, listAudit, upsertPolicy } from "./db/queries";
import { schema } from "./db/schema";
import { closeTestDb, createTestDb } from "./db/test-utils";
import type { PayPalClient, PayPalInvoice } from "./types";

const test = vi.hoisted(() => ({
  database: undefined as AppDb | undefined,
  after: vi.fn<(work: () => Promise<void>) => void>(),
  createInvoice: vi.fn<PayPalClient["createInvoice"]>(),
  sendInvoice: vi.fn<PayPalClient["sendInvoice"]>(),
  getInvoice: vi.fn<PayPalClient["getInvoice"]>(),
  cancelInvoice: vi.fn<PayPalClient["cancelInvoice"]>(),
}));

vi.mock("./db/client", async (original) => ({
  ...await original<typeof import("./db/client")>(),
  get db() { return test.database; },
}));
vi.mock("./paypal", () => ({ getPayPal: () => test }));
vi.mock("next/server", () => ({ after: test.after }));

const authTables = ["user", "session", "account", "verification", "twoFactor", "rateLimit", "auth_email_verification_tokens"];
const danaId = "invoice-dana-900";
let database: AppDb;

function post(action: string, body: unknown = {}): Request {
  return new Request(`http://localhost/api/demo/${action}`, { method: "POST", body: JSON.stringify(body) });
}

function snapshot(id: string, status: PayPalInvoice["status"], paidCents = 0): PayPalInvoice {
  return { paypalInvoiceId: id, number: id, status, amountCents: 31_500, paidCents };
}

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.stubGlobal("chaserDemoMutation", undefined);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-10T00:00:00.000Z"));
  for (const [key, value] of Object.entries({
    NODE_ENV: "production", DEMO_PUBLIC: "1", LLM_MODE: "scripted", DEMO_NOW: "2026-11-10T00:00:00.000Z",
    TURSO_DATABASE_URL: "libsql://fixture.turso.io", TURSO_AUTH_TOKEN: "fixture-token",
    PAYPAL_MODE: "sandbox", PAYPAL_CLIENT_ID: "fixture-client", PAYPAL_CLIENT_SECRET: "fixture-secret",
    PAYPAL_SANDBOX_MERCHANT_EMAIL: "merchant@example.com", PAYPAL_SANDBOX_BUYER_EMAIL: "buyer@example.com",
  })) vi.stubEnv(key, value);

  const sqlite = new LibSqlite(":memory:");
  sqlite.pragma("foreign_keys = ON");
  database = test.database = createTestDb(drizzle(sqlite as unknown as AppDb["$client"], { schema }));
  test.createInvoice.mockImplementation(async ({ number, amountCents }) => {
    const id = `INV2-TEST-${test.createInvoice.mock.calls.length}`;
    return { ...snapshot(id, "DRAFT"), number, amountCents, recipientViewUrl: `https://www.sandbox.paypal.com/invoice/p/#${id}` };
  });
});

afterEach(() => {
  closeTestDb(database);
  test.database = undefined;
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("public demo replay with native libSQL", () => {
  it("relays Priya’s owner counter only after an eligible dispute and under the current cap", async () => {
    const { POST: reset } = await import("@/app/api/demo/reset/route");
    const { POST: step } = await import("@/app/api/demo/step/route");
    const invoiceId = "invoice-priya-600";
    const counter = { invoiceId, action: "priya-counter" };
    expect((await reset(post("reset"))).status).toBe(200);
    expect((await step(post("step", counter))).status).toBe(409);
    vi.setSystemTime(Date.now() + 1_000);
    expect((await step(post("step", { invoiceId }))).status).toBe(200);
    expect(listApprovals("PENDING", database)).toEqual([expect.objectContaining({ kind: "DISCOUNT_REQUEST", invoiceId })]);

    const policy = getPolicy(database)!;
    upsertPolicy({ ...policy, maxDiscountPercent: 4 }, database);
    vi.setSystemTime(Date.now() + 1_000);
    expect((await step(post("step", counter))).status).toBe(409);
    expect(getMessages(invoiceId, database).filter(({ direction }) => direction === "agent_to_client")).toHaveLength(0);
    upsertPolicy(policy, database);
    vi.setSystemTime(Date.now() + 1_000);
    expect((await step(post("step", counter))).status).toBe(200);
    expect(listApprovals("EDITED", database)).toHaveLength(1);
    expect(getMessages(invoiceId, database).filter(({ direction }) => direction === "agent_to_client"))
      .toEqual([expect.objectContaining({ body: expect.stringContaining("5% goodwill discount") })]);
    expect(listAudit(invoiceId, database)).toEqual(expect.arrayContaining([
      expect.objectContaining({ actor: "owner", action: "demo.approval.counter", ok: true }),
    ]));
  });

  it("replays Dana without login, preserves auth, and only cancels unpaid linked installments", async () => {
    const { POST: reset } = await import("@/app/api/demo/reset/route");
    const { POST: step } = await import("@/app/api/demo/step/route");
    const { ensureAuthSchema } = await import("./auth");
    await ensureAuthSchema();
    database.$client.exec(`
      INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt, twoFactorEnabled)
        VALUES ('owner', 'Owner', 'owner@example.com', 1, 0, 0, 1);
      INSERT INTO session (id, token, userId, expiresAt, createdAt, updatedAt) VALUES ('session', 'fixture', 'owner', 1, 0, 0);
      INSERT INTO account (id, accountId, providerId, userId, password, createdAt, updatedAt)
        VALUES ('account', 'owner', 'credential', 'owner', 'fixture', 0, 0);
      INSERT INTO verification (id, identifier, value, expiresAt, createdAt, updatedAt)
        VALUES ('verification', 'owner', 'fixture', 1, 0, 0);
      INSERT INTO twoFactor (id, secret, backupCodes, userId) VALUES ('two-factor', 'fixture', 'fixture', 'owner');
      INSERT INTO rateLimit (id, key, count, lastRequest) VALUES ('rate-limit', 'fixture', 1, 0);
      INSERT INTO auth_email_verification_tokens (token_hash, expires_at) VALUES ('fixture', '2099-11-10');
    `);
    const readAuth = () => authTables.map((table) => database.$client.prepare(`SELECT * FROM "${table}"`).all());
    const authBefore = readAuth();

    async function walkThroughDana() {
      for (let turn = 0; turn < 3; turn++) {
        vi.setSystemTime(Date.now() + 1_000);
        const response = await step(post("step", { invoiceId: danaId }));
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ done: false });
      }
      expect(getInvoice(danaId, database)?.status).toBe("SUPERSEDED");
    }

    const initialReset = await reset(post("reset"));
    expect(initialReset.status).toBe(200);
    expect(await initialReset.json()).toEqual({ reset: true, invoiceCount: 5 });
    await walkThroughDana();
    database.$client.exec("UPDATE invoices SET paypal_invoice_id = 'INV2-UNRELATED' WHERE id = 'invoice-dana-900'");
    expect(test.createInvoice.mock.calls.map(([input]) => input.amountCents)).toEqual([27_000, 31_500, 31_500]);

    test.getInvoice.mockImplementation(async (id) => {
      if (id === "INV2-TEST-1") return snapshot(id, "PAID", 27_000);
      if (id === "INV2-TEST-2") return snapshot(id, "SENT");
      return snapshot(id, "PARTIALLY_PAID", 100);
    });
    vi.setSystemTime(Date.now() + 10_000);
    expect((await reset(post("reset"))).status).toBe(200);
    expect(test.getInvoice).not.toHaveBeenCalled();
    expect(test.after).toHaveBeenCalledTimes(1);
    await test.after.mock.calls[0][0]();
    expect(test.getInvoice.mock.calls.flat().sort()).toEqual(["INV2-TEST-1", "INV2-TEST-2", "INV2-TEST-3"]);
    expect(test.cancelInvoice.mock.calls).toEqual([["INV2-TEST-2"]]);
    expect(readAuth()).toEqual(authBefore);
    expect(database.$client.prepare("SELECT id FROM plans").all()).toEqual([]);
    expect(getInvoice(danaId, database)).toMatchObject({ status: "OVERDUE", paidCents: 0, paypalInvoiceId: null });

    await walkThroughDana();
    expect(test.createInvoice.mock.calls.map(([input]) => input.amountCents)).toEqual([27_000, 31_500, 31_500, 27_000, 31_500, 31_500]);
    const numbers = test.createInvoice.mock.calls.map(([input]) => input.number);
    expect(new Set(numbers).size).toBe(6);
    expect(numbers.every((number) => number.length <= 25)).toBe(true);
  });

  it("audits lookup and cancel failures after resetting successfully", async () => {
    const { POST: reset } = await import("@/app/api/demo/reset/route");
    expect((await reset(post("reset"))).status).toBe(200);
    database.$client.exec(`
      INSERT INTO plans (id, invoice_id, status, discount_percent, total_cents, installments_json, created_by, created_at)
        VALUES ('prior-plan', '${danaId}', 'ACTIVE', 0, 90000, '[]', 'agent', '2026-11-10');
    `);
    const seededIds = database.$client.prepare("SELECT id FROM invoices WHERE id != ? AND paid_cents = 0 LIMIT 2").all(danaId) as { id: string }[];
    const link = database.$client.prepare("UPDATE invoices SET parent_invoice_id = ?, plan_id = 'prior-plan', installment_no = ?, paypal_invoice_id = ? WHERE id = ?");
    link.run(danaId, 1, "INV2-LOOKUP-ERROR", seededIds[0].id);
    link.run(danaId, 2, "INV2-CANCEL-ERROR", seededIds[1].id);
    test.getInvoice.mockImplementation(async (id) => {
      if (id === "INV2-LOOKUP-ERROR") throw new Error("unavailable");
      return snapshot(id, "SENT");
    });
    test.cancelInvoice.mockRejectedValue(new Error("unavailable"));

    vi.setSystemTime(Date.now() + 10_000);
    expect((await reset(post("reset"))).status).toBe(200);
    await test.after.mock.calls[0][0]();
    const errors = listAudit(undefined, database).filter(({ action }) => action === "demo.reset.cancel_invoice");
    expect(errors).toHaveLength(2);
    expect(errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ actor: "paypal", ok: false, input: { paypalInvoiceId: "INV2-LOOKUP-ERROR" }, result: { stage: "lookup" } }),
      expect.objectContaining({ actor: "paypal", ok: false, input: { paypalInvoiceId: "INV2-CANCEL-ERROR" }, result: { stage: "cancel" } }),
    ]));
  });

  it("rolls back the business reset if reseeding fails", async () => {
    const { POST: reset } = await import("@/app/api/demo/reset/route");
    expect((await reset(post("reset"))).status).toBe(200);
    database.$client.exec(`
      UPDATE invoices SET description = 'prior description' WHERE id = '${danaId}';
      CREATE TRIGGER fail_demo_seed BEFORE INSERT ON invoices BEGIN SELECT RAISE(ABORT, 'test rollback'); END;
    `);
    vi.setSystemTime(Date.now() + 10_000);
    expect((await reset(post("reset"))).status).toBe(500);
    expect(getInvoice(danaId, database)?.description).toBe("prior description");
    expect(test.after).not.toHaveBeenCalled();
  });

  it("rate-limits every public demo action and serializes overlapping mutations", async () => {
    const { withDemoMutation } = await import("./demo");
    const complete = Promise.withResolvers<Response>();
    const active = withDemoMutation("reset", () => complete.promise);
    const run = vi.fn(async () => new Response());
    expect((await withDemoMutation("step", run)).status).toBe(429);
    expect(run).not.toHaveBeenCalled();
    complete.resolve(new Response());
    await active;
    const blocked = await withDemoMutation("reset", run);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBe("10");
    for (const action of ["step", "advance-time", "simulate-payment"] as const) {
      expect((await withDemoMutation(action, run)).status).toBe(200);
      expect((await withDemoMutation(action, run)).status).toBe(429);
    }
    vi.setSystemTime(Date.now() + 10_000);
    expect((await withDemoMutation("reset", run)).status).toBe(200);
  });

  it("keeps private Sandbox reset and manual Turso seed blocked", async () => {
    vi.stubEnv("DEMO_PUBLIC", "0");
    const { resetDemo } = await import("./demo");
    const { seedDatabase } = await import("./db/seed");
    expect((await resetDemo()).status).toBe(409);
    await expect(seedDatabase()).rejects.toThrow("hosted Turso database");
    vi.stubEnv("PAYPAL_MODE", "mock");
    expect((await resetDemo()).status).toBe(500);
    vi.stubEnv("DEMO_PUBLIC", "1");
    await expect(seedDatabase()).rejects.toThrow("hosted Turso database");
  });
});
