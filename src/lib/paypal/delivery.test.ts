import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as events } from "@/app/api/events/route";
import { POST as advance } from "@/app/api/demo/advance-time/route";
import { POST as reset } from "@/app/api/demo/reset/route";
import { POST as simulate } from "@/app/api/demo/simulate-payment/route";
import { POST as step } from "@/app/api/demo/step/route";
import * as webhook from "@/app/api/webhooks/paypal/route";
import { getInvoice, getPlan, insertMockPaypalInvoice, insertPlan, listAudit } from "../db/queries";
import { clients, invoices, webhookEvents } from "../db/schema";
import { closeTestDb, createTestDb } from "../db/test-utils";
import type { AppDb } from "../db/client";
import { subscribe, type AppEvent } from "../events";
import { clearTokenCache } from "./auth";
import { MockPayPalClient } from "./mock";
import { retryPendingPayPalWebhooks } from "./webhook";
import { reconcilePayPalInvoice } from "./reconcile";

const test = vi.hoisted(() => ({
  database: undefined as AppDb | undefined,
  authenticated: true,
  schedule: vi.fn<(work: () => Promise<void>) => void>(),
}));

vi.mock("../db/client", async (original) => ({
  ...await original<typeof import("../db/client")>(),
  get db() { return test.database; },
}));
vi.mock("../auth", () => ({
  isDemoRequestAuthenticated: async () => test.authenticated,
  unauthorizedResponse: () => new Response(null, { status: 401 }),
}));
vi.mock("next/server", () => ({ after: test.schedule }));

const NOW = "2026-11-10T00:00:00.000Z";
const DUE = "2026-11-14T00:00:00.000Z";
const paidEvent = "INVOICING.INVOICE.PAID";
const originalId = "original";
let database: AppDb;
let mock: MockPayPalClient;

function insertInvoice(id: string, installmentNo?: number) {
  const paypalId = `MOCK-INV2-${id.toUpperCase()}`;
  database.insert(invoices).values({
    id, clientId: "test-client", number: id, description: "Demo invoice",
    amountCents: 10_000, issuedAt: NOW, dueAt: DUE, status: "SENT", paypalInvoiceId: paypalId,
    ...(installmentNo ? { installmentNo, parentInvoiceId: originalId, planId: "plan" } : {}),
  }).run();
  insertMockPaypalInvoice({
    id: paypalId, number: id, amountCents: 10_000, paidCents: 0, status: "SENT",
    recipientViewUrl: `http://localhost/mock-paypal/invoice/${paypalId}`, createdAt: NOW,
  }, database);
  return paypalId;
}

function insertActivePlan() {
  insertInvoice(originalId);
  database.$client.prepare("UPDATE invoices SET status = 'SUPERSEDED', chase_state = 'PLAN_ACTIVE', plan_id = 'plan' WHERE id = ?").run(originalId);
  insertPlan({
    id: "plan", invoiceId: originalId, status: "ACTIVE", discountPercent: 0, totalCents: 20_000,
    installments: [1, 2].map((no) => ({ no, amountCents: 10_000, dueAt: DUE })),
    createdBy: "agent", approvedBy: "policy", createdAt: NOW,
  }, database);
  return [insertInvoice("first", 1), insertInvoice("second", 2)] as const;
}

function post(path: string, body: unknown, headers?: Record<string, string>): Request {
  return new Request(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
}

function event(id: string, paypalId: string, headers = { "x-chaser-mock-webhook": "1" }) {
  return post("/api/webhooks/paypal", {
    id, event_type: paidEvent,
    resource: { id: paypalId, status: "PAID", payer_email: "fictional@example.com", payments: [{ amount: "999.99" }] },
  }, headers);
}

async function flushAfter() {
  const work = test.schedule.mock.calls.splice(0);
  for (const [callback] of work) await callback();
}

beforeEach(() => {
  database = test.database = createTestDb();
  database.insert(clients).values({ id: "test-client", name: "Test Client", email: "fictional@example.com", responsiveness: "high" }).run();
  mock = new MockPayPalClient(database);
  test.schedule.mockClear();
  test.authenticated = true;
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("DEMO_PUBLIC", "0");
  vi.stubEnv("PAYPAL_MODE", "mock");
  vi.stubEnv("LLM_MODE", "scripted");
  vi.stubEnv("DEMO_NOW", NOW);
  clearTokenCache();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  closeTestDb(database);
  test.database = undefined;
});

describe("PayPal webhook route", () => {
  it("exports POST only so Next returns 405 for GET", () => {
    expect(webhook).toHaveProperty("POST");
    expect(webhook).not.toHaveProperty("GET");
  });

  it.each(["0", "1"])("accepts verified mock deliveries without an owner session with DEMO_PUBLIC=%s", async (demoPublic) => {
    test.authenticated = false;
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEMO_PUBLIC", demoPublic);
    expect((await webhook.POST(event("WH-ANON", "MOCK-UNKNOWN"))).status).toBe(200);
    await flushAfter();
    expect(listAudit(undefined, database)[0]).toMatchObject({ actor: "paypal", action: "webhook.invoice.unmatched", ok: false });
  });

  it("rejects a missing mock header without writing an event", async () => {
    expect((await webhook.POST(event("WH-INVALID", "MOCK-UNKNOWN", {} as Record<"x-chaser-mock-webhook", string>))).status).toBe(400);
    expect(database.select().from(webhookEvents).all()).toEqual([]);
  });

  it("acknowledges before reconciliation and dedupes both pending and processed event IDs", async () => {
    const paypalId = insertInvoice("linked");
    await mock.simulatePayment(paypalId);
    const replies = await Promise.all([webhook.POST(event("WH-ONCE", paypalId)), webhook.POST(event("WH-ONCE", paypalId))]);
    expect(replies.map((response) => response.status)).toEqual([200, 200]);
    expect(test.schedule).toHaveBeenCalledTimes(1);
    expect(getInvoice("linked", database)?.paidCents).toBe(0);
    expect(database.select().from(webhookEvents).all()).toEqual([
      expect.objectContaining({ id: "WH-ONCE", payloadJson: JSON.stringify({ paypalInvoiceId: paypalId }), processedAt: null }),
    ]);
    await flushAfter();
    expect(getInvoice("linked", database)).toMatchObject({ status: "PAID", paidCents: 10_000, chaseState: "RESOLVED" });
    expect(database.select().from(webhookEvents).get()?.processedAt).toBeTruthy();
    await webhook.POST(event("WH-ONCE", paypalId));
    expect(test.schedule.mock.calls).toHaveLength(0);
  });

  it("updates plan progress and resolves the plan and original only when every installment is paid", async () => {
    const [first, second] = insertActivePlan();
    await mock.simulatePayment(first);
    await webhook.POST(event("WH-FIRST", first));
    await flushAfter();
    expect(getInvoice("first", database)).toMatchObject({ status: "PAID", paidCents: 10_000 });
    expect(getPlan("plan", database)?.status).toBe("ACTIVE");
    expect(listAudit(originalId, database)[0]?.result).toMatchObject({ paidInstallments: 1, totalInstallments: 2 });
    await mock.simulatePayment(second);
    await webhook.POST(event("WH-SECOND", second));
    await flushAfter();
    expect(getPlan("plan", database)?.status).toBe("RESOLVED");
    expect(getInvoice(originalId, database)).toMatchObject({ status: "SUPERSEDED", chaseState: "RESOLVED", paidCents: 0 });
  });

  it("refreshes webhook evidence after reconciliation without repeating the payment notice", async () => {
    const paypalId = insertInvoice("already-paid");
    await mock.simulatePayment(paypalId);
    await reconcilePayPalInvoice(paypalId, database, mock);
    const received: AppEvent[] = [];
    const unsubscribe = subscribe((notification) => {
      expect(database.select().from(webhookEvents).get()?.processedAt).toBeTruthy();
      received.push(notification);
    });
    try {
      expect((await webhook.POST(event("WH-LATE", paypalId))).status).toBe(200);
      await flushAfter();
      expect((await webhook.POST(event("WH-LATE", paypalId))).status).toBe(200);
      await flushAfter();
      expect(received).toEqual([expect.objectContaining({ type: "paypal.webhook.processed", invoiceId: "already-paid" })]);
      expect(getInvoice("already-paid", database)?.paidCents).toBe(10_000);
    } finally {
      unsubscribe();
    }
  });

  it("uses authoritative partial amounts and updates cents even when the status stays the same", async () => {
    const paypalId = insertInvoice("partial");
    for (const [i, paidCents] of [1_500, 3_000].entries()) {
      await mock.simulatePayment(paypalId, 1_500);
      await webhook.POST(event(`WH-PARTIAL-${i}`, paypalId));
      await flushAfter();
      expect(getInvoice("partial", database)).toMatchObject({ status: "PARTIALLY_PAID", paidCents });
    }
  });

  it("retries a recorded event whose authoritative lookup temporarily failed", async () => {
    const paypalId = insertInvoice("recover");
    await mock.simulatePayment(paypalId);
    const lookup = vi.spyOn(MockPayPalClient.prototype, "getInvoice").mockRejectedValueOnce(new Error("Transient error"));
    try {
      expect((await webhook.POST(event("WH-RETRY", paypalId))).status).toBe(200);
      await flushAfter();
      expect(database.select().from(webhookEvents).get()?.processedAt).toBeNull();
      await retryPendingPayPalWebhooks();
      expect(getInvoice("recover", database)?.status).toBe("PAID");
      expect(database.select().from(webhookEvents).get()?.processedAt).toBeTruthy();
    } finally {
      lookup.mockRestore();
    }
  });

  it.each(["SUCCESS", "FAILURE"])("requires Sandbox verification result %s from PayPal", async (verificationStatus) => {
    useSandbox();
    const body = { id: "WH-SANDBOX", event_type: paidEvent, resource: { id: "INV2-UNKNOWN", invoice_number: "fictional" } };
    const fetch = vi.fn(async (url: string) => url.endsWith("/v1/oauth2/token")
      ? Response.json({ access_token: "fixture-token", expires_in: 120 })
      : Response.json({ verification_status: verificationStatus }));
    vi.stubGlobal("fetch", fetch);
    const response = await webhook.POST(post("/api/webhooks/paypal", body, {
      "paypal-auth-algo": "SHA256withRSA", "paypal-cert-url": "https://api-m.sandbox.paypal.com/cert",
      "paypal-transmission-id": "fixture-transmission", "paypal-transmission-sig": "fixture-signature",
      "paypal-transmission-time": NOW,
    }));
    expect(response.status).toBe(verificationStatus === "SUCCESS" ? 200 : 400);
    expect(fetch).toHaveBeenLastCalledWith(expect.stringMatching(/\/v1\/notifications\/verify-webhook-signature$/), expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        auth_algo: "SHA256withRSA", cert_url: "https://api-m.sandbox.paypal.com/cert",
        transmission_id: "fixture-transmission", transmission_sig: "fixture-signature", transmission_time: NOW,
        webhook_id: "fixture-webhook", webhook_event: body,
      }),
    }));
    await flushAfter();
    expect(database.select().from(webhookEvents).all()).toHaveLength(verificationStatus === "SUCCESS" ? 1 : 0);
  });

  it("does not accept the mock header in Sandbox", async () => {
    useSandbox();
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect((await webhook.POST(event("WH-MOCK", "INV2-UNKNOWN"))).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
});

function useSandbox() {
  vi.stubEnv("PAYPAL_MODE", "sandbox");
  vi.stubEnv("PAYPAL_BASE_URL", "https://api-m.sandbox.paypal.com");
  vi.stubEnv("PAYPAL_CLIENT_ID", "fixture-client");
  vi.stubEnv("PAYPAL_CLIENT_SECRET", "fixture-secret");
  vi.stubEnv("PAYPAL_WEBHOOK_ID", "fixture-webhook");
}

describe("demo routes and workspace events", () => {
  it.each([
    ["mock", "simulate the next unpaid installment"],
    ["sandbox", "use the PayPal Sandbox link for the next unpaid installment"],
  ] as const)("returns %s payment instructions for an active Dana plan", async (mode, instruction) => {
    if (mode === "sandbox") useSandbox();
    const invoiceId = "invoice-dana-900";
    insertInvoice(invoiceId);
    database.update(clients).set({ persona: "dana" }).run();
    insertPlan({
      id: "dana-plan", invoiceId, status: "ACTIVE", totalCents: 10_000, discountPercent: 0,
      installments: [{ no: 1, amountCents: 10_000, dueAt: DUE }],
      createdBy: "agent", approvedBy: "policy", createdAt: NOW,
    }, database);
    const response = await step(post("/api/demo/step", { invoiceId }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ done: true, message: expect.stringContaining(instruction) });
  });

  it.each([
    ["production", "0", 404], ["production", "1", 400], ["development", "0", 400],
    ["development", "1", 400], ["test", "0", 400], ["test", "1", 400],
  ] as const)("gates all demo routes in %s with DEMO_PUBLIC=%s", async (nodeEnv, publicMode, expected) => {
    vi.stubEnv("NODE_ENV", nodeEnv);
    vi.stubEnv("DEMO_PUBLIC", publicMode);
    for (const [name, handler] of [["reset", reset], ["advance-time", advance], ["simulate-payment", simulate], ["step", step]] as const) {
      expect((await handler(post(`/api/demo/${name}`, { invalid: true }))).status).toBe(expected);
    }
  });

  it("retains workspace authorization for enabled demo routes and SSE", async () => {
    test.authenticated = false;
    expect((await simulate(post("/api/demo/simulate-payment", { invoiceId: "local" }))).status).toBe(401);
    expect((await events(new Request("http://localhost/api/events"))).status).toBe(401);
  });

  it("recomputes overdue status and risk when advancing time", async () => {
    insertInvoice("time-test");
    expect(getInvoice("time-test", database)?.status).toBe("SENT");
    const response = await advance(post("/api/demo/advance-time", { days: 7 }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ now: "2026-11-17T00:00:00.000Z", overdueUpdated: 1, refreshed: 1 });
    expect(getInvoice("time-test", database)).toMatchObject({ status: "OVERDUE", riskScore: expect.any(Number) });
  });

  it("simulates a mock payment by local ID and sends the updated local invoice over SSE", async () => {
    const paypalId = insertInvoice("local");
    const abort = new AbortController();
    const response = await events(new Request("http://localhost/api/events", { signal: abort.signal }));
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    try {
      expect(decoder.decode((await reader.read()).value)).toContain(": connected");
      const payment = await simulate(post("/api/demo/simulate-payment", { invoiceId: "local", amountCents: 2500 }));
      expect(payment.status).toBe(200);
      expect(await payment.json()).toMatchObject({ paypalInvoiceId: paypalId, status: "PARTIALLY_PAID" });
      for (const type of ["invoice.updated", "invoice.paid"]) {
        const frame = decoder.decode((await reader.read()).value);
        expect(JSON.parse(frame.slice("data: ".length))).toMatchObject({ type, invoiceId: "local" });
      }
      expect(getInvoice("local", database)?.paidCents).toBe(2500);
    } finally {
      abort.abort();
      await reader.cancel();
    }
  });

  it("sends an SSE comment heartbeat every 15 seconds and closes on abort", async () => {
    vi.useFakeTimers();
    const abort = new AbortController();
    const response = await events(new Request("http://localhost/api/events", { signal: abort.signal }));
    const reader = response.body!.getReader();
    await reader.read();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(new TextDecoder().decode((await reader.read()).value)).toBe(": heartbeat\n\n");
    abort.abort();
    expect((await reader.read()).done).toBe(true);
  });

  it("reconciles a Sandbox payment and returns 409 with the PayPal payment instruction", async () => {
    useSandbox();
    const paypalId = insertInvoice("sandbox");
    const fetch = vi.fn(async (url: string) => url.endsWith("/v1/oauth2/token")
      ? Response.json({ access_token: "fixture-token", expires_in: 120 })
      : Response.json({ id: paypalId, status: "PAID", detail: { invoice_number: "sandbox" }, payments: { paid_amount: { value: "100.00" } } }));
    vi.stubGlobal("fetch", fetch);
    const response = await simulate(post("/api/demo/simulate-payment", { invoiceId: "sandbox" }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { message: expect.stringContaining("Pay on the PayPal Sandbox invoice page") } });
    expect(getInvoice("sandbox", database)).toMatchObject({ status: "PAID", paidCents: 10_000 });
  });
});
