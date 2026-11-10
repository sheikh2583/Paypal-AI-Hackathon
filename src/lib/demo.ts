import { audit } from "./audit";
import { isDemoRequestAuthenticated, unauthorizedResponse } from "./auth";
import { advanceDays, getNow } from "./clock";
import { db, type AppDb } from "./db/client";
import { listInvoices, updateInvoice } from "./db/queries";
import { getAppEnv } from "./env";
import { emit } from "./events";
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
