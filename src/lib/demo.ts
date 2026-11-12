import { after } from "next/server";
import { audit } from "./audit";
import { isDemoRequestAuthenticated, unauthorizedResponse } from "./auth";
import { advanceDays, getNow } from "./clock";
import { db, type AppDb } from "./db/client";
import { listInvoices, listIssuedPayPalInstallmentIds, updateInvoice } from "./db/queries";
import { resetPublicDemoSeed, seedDatabase } from "./db/seed";
import { getAppEnv, getDatabaseEnv, getPayPalEnv } from "./env";
import { emit } from "./events";
import { getPayPal } from "./paypal";
import { rememberResetPayPalCancellations } from "./paypal/reset-cleanup";
import { PayPalError } from "./paypal/real";
import { refreshRisk } from "./risk/service";

export function demoEnabled(): boolean {
  return process.env.NODE_ENV !== "production" || getAppEnv().demoPublic;
}

export function demoError(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status });
}

export async function guardDemoRoute(): Promise<Response | undefined> {
  if (!demoEnabled()) return demoError(404, "NOT_FOUND", "Demo controls are disabled.");
  if (!(await isDemoRequestAuthenticated())) return unauthorizedResponse();
}

const cooldownMs = { reset: 10_000, step: 1_000, "advance-time": 2_000, "simulate-payment": 2_000 };
type DemoAction = keyof typeof cooldownMs;
type DemoMutationState = { active: boolean; nextAllowedAt: Partial<Record<DemoAction, number>> };
const processScope = globalThis as typeof globalThis & { chaserDemoMutation?: DemoMutationState };
const mutation = processScope.chaserDemoMutation ??= { active: false, nextAllowedAt: {} };

/** Reset process-scoped cooldown state between isolated tests; never called by app routes. */
export function __resetDemoMutationStateForTests(): void {
  mutation.active = false;
  mutation.nextAllowedAt = {};
}

export async function withDemoMutation(action: DemoAction, run: () => Promise<Response>): Promise<Response> {
  if (!getAppEnv().demoPublic) return run();

  const now = Date.now();
  const remaining = (mutation.nextAllowedAt[action] ?? 0) - now;
  if (mutation.active || remaining > 0) {
    const response = demoError(429, "DEMO_RATE_LIMIT", "Please wait a moment before trying this demo action again.");
    response.headers.set("Retry-After", String(Math.max(1, Math.ceil(remaining / 1_000))));
    return response;
  }

  mutation.active = true;
  mutation.nextAllowedAt[action] = now + cooldownMs[action];
  try {
    return await run();
  } finally {
    mutation.active = false;
  }
}

export function demoResetAvailable(paypalMode: "mock" | "sandbox"): boolean {
  return getAppEnv().demoPublic || (paypalMode === "mock" && getDatabaseEnv().mode === "local");
}

export async function resetDemo(database: AppDb = db): Promise<Response> {
  const { mode, buyerEmail } = getPayPalEnv();
  const isPublic = getAppEnv().demoPublic;
  if (!isPublic && mode !== "mock") return demoError(409, "MOCK_ONLY", "Demo reset is only available in mock mode.");
  try {
    const paypalIds = mode === "sandbox" ? listIssuedPayPalInstallmentIds(database) : [];
    const invoices = isPublic
      ? await resetPublicDemoSeed(database, { paypalMode: mode, sandboxBuyerEmail: buyerEmail })
      : await seedDatabase(database, { paypalMode: "mock" });
    if (paypalIds.length > 0) {
      rememberResetPayPalCancellations(paypalIds, database);
      after(() => cancelResetPayPalInvoices(paypalIds, database));
    }
    emit({ type: "invoice.updated", at: getNow(database).toISOString() });
    return Response.json({ reset: true, invoiceCount: invoices.length });
  } catch {
    return demoError(500, "DEMO_RESET_FAILED", "The demo data could not be reset.");
  }
}

async function cancelResetPayPalInvoices(paypalIds: string[], database: AppDb): Promise<void> {
  const paypal = getPayPal();
  for (const paypalInvoiceId of paypalIds) {
    let stage = "lookup";
    try {
      const invoice = await paypal.getInvoice(paypalInvoiceId);
      if (invoice.paidCents !== 0 || (invoice.status !== "SENT" && invoice.status !== "DRAFT")) continue;
      stage = "cancel";
      await paypal.cancelInvoice(paypalInvoiceId);
    } catch (error) {
      // Keep the HTTP status so a failed cleanup can be diagnosed from the audit log alone.
      const httpStatus = error instanceof PayPalError ? error.status : undefined;
      try {
        audit({ actor: "paypal", action: "demo.reset.cancel_invoice", input: { paypalInvoiceId }, result: { stage, ...(httpStatus ? { httpStatus } : {}) }, ok: false }, database, new Date().toISOString());
      } catch {
        console.warn("Could not record PayPal invoice cleanup failure during demo reset.");
      }
    }
  }
}

export async function advanceDemoTime(days: number, database: AppDb = db) {
  const { now, open, overdueUpdated } = database.$client.transaction(() => {
    advanceDays(days, database);
    const now = getNow(database);
    const open = listInvoices(database).map(({ invoice }) => invoice).filter(
      (invoice) => invoice.status === "SENT" || invoice.status === "OVERDUE" || invoice.status === "PARTIALLY_PAID",
    );
    let overdueUpdated = 0;
    for (const invoice of open) {
      if (invoice.status === "PARTIALLY_PAID") continue;
      const status = Date.parse(invoice.dueAt) < now.getTime() ? "OVERDUE" : "SENT";
      if (status === invoice.status) continue;
      updateInvoice(invoice.id, { status }, database);
      overdueUpdated++;
    }
    return { now, open, overdueUpdated };
  })();
  for (const invoice of open) await refreshRisk(invoice.id, database, now);
  const result = { now: now.toISOString(), overdueUpdated, refreshed: open.length };
  audit({ actor: "owner", action: "demo.advance_time", input: { days }, result, ok: true }, database, result.now);
  emit({ type: "invoice.updated", at: result.now });
  return result;
}
