import type { AuditEntry } from "./types";
import { getNow } from "./clock";
import { db, type AppDb } from "./db/client";
import { insertAudit } from "./db/queries";

const MAX_AUDIT_PAYLOAD_CHARS = 4_000;
const sensitiveKey = /(token|secret|authorization)/i;
const emailPattern = /\b([A-Z0-9._%+-])[A-Z0-9._%+-]*@([A-Z0-9.-]+\.[A-Z]{2,})\b/gi;

function redactText(value: string): string {
  // Google API keys can appear in provider error text; never let one reach the log.
  return value.replace(emailPattern, "$1***@$2").replace(/AIza[0-9A-Za-z_-]{10,}|AQ\.[0-9A-Za-z_.-]{20,}/g, "[redacted]");
}

function redactValue(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === "string") return redactText(value);
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Error) return { name: value.name, message: redactText(value.message) };
  if (Array.isArray(value)) return value.map((item) => redactValue(item, seen));
  if (value && typeof value === "object") {
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (sensitiveKey.test(key)) continue;
      result[key] = redactValue(entry, seen);
    }
    seen.delete(value);
    return result;
  }
  return value ?? null;
}

export function redactAuditPayload(value: unknown): unknown {
  const redacted = redactValue(value, new WeakSet());
  const serialized = JSON.stringify(redacted);
  if (serialized.length <= MAX_AUDIT_PAYLOAD_CHARS) return redacted;
  return {
    truncated: true,
    preview: serialized.slice(0, MAX_AUDIT_PAYLOAD_CHARS),
  };
}

export interface AuditInput {
  actor: AuditEntry["actor"];
  action: string;
  invoiceId?: string;
  input?: unknown;
  result?: unknown;
  ok: boolean;
}

/**
 * Records one AI provider call by key number and model (D75). The key, headers, URL and prompt are never
 * passed in, so they cannot reach the audit log.
 */
export function auditProviderCall(
  record: { keyNumber: number; model: string; latencyMs: number; status: number; ok: boolean },
  context: { invoiceId?: string | null; purpose: string; provider: string },
  database: AppDb = db,
): void {
  try {
    audit({
      actor: "system",
      action: "llm.call",
      invoiceId: context.invoiceId ?? undefined,
      input: { provider: context.provider, purpose: context.purpose, keyNumber: record.keyNumber, model: record.model },
      result: { status: record.status, latencyMs: record.latencyMs },
      ok: record.ok,
    }, database);
  } catch {
    // Auditing a provider call must never break the call itself.
  }
}

export function audit(entry: AuditInput, database: AppDb = db, at = getNow().toISOString()): AuditEntry {
  return insertAudit({
    id: crypto.randomUUID(),
    at,
    actor: entry.actor,
    action: entry.action,
    invoiceId: entry.invoiceId ?? null,
    input: redactAuditPayload(entry.input ?? null),
    result: redactAuditPayload(entry.result ?? null),
    ok: entry.ok,
  }, database);
}
