import { getKv, setKv } from "../db/queries";
import type { AppDb } from "../db/client";

const CLEANUP_KEY = "paypal_reset_cleanup";
const RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;

type CleanupRecords = Record<string, number>;

function readRecords(database: AppDb): CleanupRecords {
  const raw = getKv(CLEANUP_KEY, database);
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(
      (entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1]),
    ));
  } catch {
    return {};
  }
}

/** Keeps a bounded window for late cancellation notifications after demo reset. */
export function rememberResetPayPalCancellations(
  paypalInvoiceIds: string[],
  database: AppDb,
  now = Date.now(),
): void {
  const records = Object.fromEntries(Object.entries(readRecords(database)).filter(([, expiresAt]) => expiresAt > now));
  for (const id of paypalInvoiceIds) records[id] = now + RETENTION_MS;
  if (Object.keys(records).length > 0) setKv(CLEANUP_KEY, JSON.stringify(records), database);
}

export function isExpectedResetPayPalCancellation(
  paypalInvoiceId: string,
  database: AppDb,
  now = Date.now(),
): boolean {
  const records = readRecords(database);
  const expiresAt = records[paypalInvoiceId];
  if (expiresAt === undefined) return false;
  if (expiresAt > now) return true;
  delete records[paypalInvoiceId];
  if (Object.keys(records).length > 0) setKv(CLEANUP_KEY, JSON.stringify(records), database);
  else setKv(CLEANUP_KEY, "{}", database);
  return false;
}
