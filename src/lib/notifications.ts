// Owner alerts: when the agent needs a human decision, email the owner a one-line
// request with a link. Delivery is fire-and-forget and never blocks the agent.
import { Resend } from "resend";
import { audit } from "./audit";
import { db, type AppDb } from "./db/client";
import { getClient, getInvoice, listApprovals } from "./db/queries";
import { getAuthEnv, type AuthEnv } from "./env";
import { subscribe } from "./events";
import { approvalKindLabels } from "./labels";
import type { ApprovalRow, ClientRow, InvoiceRow } from "./types";

export interface OwnerAlert {
  subject: string;
  heading: string;
  message: string;
  actionLabel: string;
  actionUrl: string;
}

export type OwnerAlertOutcome = "sent" | "skipped_not_configured" | "skipped_duplicate" | "failed";
export type OwnerEmailSender = (to: string, alert: OwnerAlert) => Promise<void>;

const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
// Process-scoped so a hot reload in development does not re-send the same alert.
const scope = globalThis as typeof globalThis & { chaserNotifiedApprovals?: Set<string>; chaserNotificationsRegistered?: boolean };
const notified = scope.chaserNotifiedApprovals ??= new Set<string>();

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

export function buildApprovalAlert(approval: ApprovalRow, invoice: InvoiceRow, client: ClientRow, baseUrl: string): OwnerAlert {
  const kind = approvalKindLabels[approval.kind];
  const balance = money(Math.max(0, invoice.amountCents - invoice.paidCents));
  return {
    subject: `Chaser needs your decision: ${client.name}, ${invoice.number}`,
    heading: kind,
    message: `${client.name} · ${invoice.number} · ${balance} outstanding. ${approval.reason} Chaser recommends: ${approval.recommendation}`,
    actionLabel: "Review in Chaser",
    actionUrl: new URL("/approvals", baseUrl).toString(),
  };
}

export function ownerEmailHtml(alert: OwnerAlert): string {
  return `<!doctype html><html><body style="margin:0;background:#f4f7fb;font-family:Arial,sans-serif;color:#16202a"><main style="max-width:560px;margin:36px auto;padding:32px;background:#fff;border:1px solid #e3e9ef;border-radius:18px"><p style="margin:0 0 22px;color:#155e75;font-weight:700">CHASER</p><h1 style="font-size:22px;margin:0 0 14px">${escapeHtml(alert.heading)}</h1><p style="font-size:15px;line-height:1.6;color:#52606d">${escapeHtml(alert.message)}</p><p style="margin:28px 0"><a href="${escapeHtml(alert.actionUrl)}" style="display:inline-block;background:#075985;color:#fff;text-decoration:none;padding:13px 18px;border-radius:10px;font-weight:700">${escapeHtml(alert.actionLabel)}</a></p><p style="font-size:12px;line-height:1.6;color:#75818d">Chaser paused this invoice until you decide. Nothing outside your policy happens without you.</p></main></body></html>`;
}

async function sendWithResend(config: AuthEnv): Promise<OwnerEmailSender> {
  const resend = new Resend(config.resendApiKey);
  return async (to, alert) => {
    const { error } = await resend.emails.send({
      from: config.resendFrom ?? "",
      to: [to],
      subject: alert.subject,
      html: ownerEmailHtml(alert),
      text: `${alert.heading}\n\n${alert.message}\n\n${alert.actionLabel}: ${alert.actionUrl}`,
    });
    if (error) throw new Error("provider rejected the email request");
  };
}

/** Emails the owner about one pending approval. Returns what happened; never throws. */
export async function notifyOwnerOfApproval(
  approval: ApprovalRow,
  options: { database?: AppDb; config?: AuthEnv; send?: OwnerEmailSender } = {},
): Promise<OwnerAlertOutcome> {
  const database = options.database ?? db;
  const config = options.config ?? getAuthEnv();
  const record = (outcome: OwnerAlertOutcome, ok = true) => {
    audit({
      actor: "system", action: "owner.notified", invoiceId: approval.invoiceId,
      input: { approvalId: approval.id, kind: approval.kind, channel: "email" }, result: { outcome }, ok,
    }, database);
    return outcome;
  };
  if (notified.has(approval.id)) return "skipped_duplicate";
  notified.add(approval.id);
  if (!config.ownerEmail || !config.resendApiKey || !config.resendFrom) return record("skipped_not_configured");
  const invoice = getInvoice(approval.invoiceId, database);
  const client = invoice ? getClient(invoice.clientId, database) : undefined;
  if (!invoice || !client) return record("failed", false);
  try {
    const send = options.send ?? await sendWithResend(config);
    await send(config.ownerEmail, buildApprovalAlert(approval, invoice, client, config.baseUrl));
    return record("sent");
  } catch {
    // Provider errors may carry addresses; the audit entry keeps only the outcome.
    return record("failed", false);
  }
}

/** Subscribes to approval events once per process; returns the unsubscribe handle. */
export function registerOwnerNotifications(options: { database?: AppDb; config?: AuthEnv; send?: OwnerEmailSender } = {}): () => void {
  if (scope.chaserNotificationsRegistered) return () => {};
  scope.chaserNotificationsRegistered = true;
  const unsubscribe = subscribe((event) => {
    if (event.type !== "approval.created" || !event.invoiceId) return;
    const database = options.database ?? db;
    const pending = listApprovals("PENDING", database)
      .filter((approval) => approval.invoiceId === event.invoiceId && !notified.has(approval.id))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    for (const approval of pending) void notifyOwnerOfApproval(approval, { database, config: options.config, send: options.send });
  });
  return () => { unsubscribe(); scope.chaserNotificationsRegistered = false; };
}

/** Test seam: forgets which approvals were already announced. */
export function __resetOwnerNotificationsForTests(): void {
  notified.clear();
  scope.chaserNotificationsRegistered = false;
}
