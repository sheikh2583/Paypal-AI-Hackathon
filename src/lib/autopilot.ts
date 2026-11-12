// Autopilot: an owner-controlled switch that lets Chaser act on due invoices on a
// schedule instead of waiting for a click. Off by default so guided demos stay
// deterministic; every run is audited like a manual one.
import { runAgent } from "./agent/run";
import { audit } from "./audit";
import { getNow } from "./clock";
import { db, type AppDb } from "./db/client";
import { getKv, listInvoices, setKv } from "./db/queries";
import { getAppEnv, getLlmEnv } from "./env";
import type { AgentRunResult, InvoiceRow } from "./types";

const ENABLED_KEY = "autopilot_enabled";
const LAST_RUN_KEY = "autopilot_last_run";
export const AUTOPILOT_INTERVAL_MINUTES = 30;
// Live providers on free tiers allow few requests per minute; a short gap between
// invoices keeps a scheduled sweep under those caps.
const LIVE_GAP_MS = 4_500;

export type AutopilotTrigger = "schedule" | "manual";

export interface AutopilotLastRun { at: string; trigger: AutopilotTrigger; dueCount: number; ranCount: number; failedCount: number }

export interface AutopilotStatus {
  enabled: boolean;
  lastRun: AutopilotLastRun | null;
  dueNow: number;
  intervalMinutes: number;
  /** False when no CRON_SECRET is set, so the switch alone never triggers a scheduled check. */
  scheduleConfigured: boolean;
}

export interface AutopilotRunResult {
  ran: boolean;
  reason?: "autopilot_off";
  dueCount: number;
  results: AgentRunResult[];
  failed: { invoiceId: string; code: string }[];
}

export function isAutopilotEnabled(database: AppDb = db): boolean {
  return getKv(ENABLED_KEY, database) === "1";
}

export function setAutopilotEnabled(enabled: boolean, database: AppDb = db): void {
  setKv(ENABLED_KEY, enabled ? "1" : "0", database);
  audit({ actor: "owner", action: "autopilot.toggle", input: { enabled }, result: { ok: true }, ok: true }, database);
}

export function listDueInvoices(database: AppDb = db, now = getNow(database)): InvoiceRow[] {
  return listInvoices(database).map(({ invoice }) => invoice).filter((invoice) =>
    invoice.nextFollowupAt !== null && Date.parse(invoice.nextFollowupAt) <= now.getTime());
}

export function getAutopilotStatus(database: AppDb = db): AutopilotStatus {
  const raw = getKv(LAST_RUN_KEY, database);
  let lastRun: AutopilotLastRun | null = null;
  if (raw) {
    try { lastRun = JSON.parse(raw) as AutopilotLastRun; } catch { lastRun = null; }
  }
  return {
    enabled: isAutopilotEnabled(database),
    lastRun,
    dueNow: listDueInvoices(database).length,
    intervalMinutes: AUTOPILOT_INTERVAL_MINUTES,
    scheduleConfigured: Boolean(getAppEnv().cronSecret),
  };
}

/** Runs every due invoice through the agent. Scheduled triggers respect the switch; manual ones do not. */
export async function runAutopilot(
  trigger: AutopilotTrigger,
  options: { database?: AppDb; sleep?: (ms: number) => Promise<void> } = {},
): Promise<AutopilotRunResult> {
  const database = options.database ?? db;
  const due = listDueInvoices(database);
  if (trigger === "schedule" && !isAutopilotEnabled(database)) {
    return { ran: false, reason: "autopilot_off", dueCount: due.length, results: [], failed: [] };
  }
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const gap = getLlmEnv().mode === "live" ? LIVE_GAP_MS : 0;
  const results: AgentRunResult[] = [];
  const failed: { invoiceId: string; code: string }[] = [];
  for (const [index, invoice] of due.entries()) {
    if (index > 0 && gap > 0) await sleep(gap);
    try {
      results.push(await runAgent(invoice.id, "due", { database }));
    } catch (error) {
      // One stuck invoice must not stop the sweep; the failed run is already audited by runAgent.
      failed.push({ invoiceId: invoice.id, code: error instanceof Error ? error.message : "AGENT_RUN_FAILED" });
    }
  }
  const at = getNow(database).toISOString();
  const lastRun: AutopilotLastRun = { at, trigger, dueCount: due.length, ranCount: results.length, failedCount: failed.length };
  setKv(LAST_RUN_KEY, JSON.stringify(lastRun), database);
  audit({
    actor: "system", action: "autopilot.run",
    input: { trigger, dueCount: due.length },
    result: { ok: true, ranCount: results.length, failedCount: failed.length, outcomes: results.map(({ finalState }) => finalState) }, ok: true,
  }, database);
  return { ran: true, dueCount: due.length, results, failed };
}
