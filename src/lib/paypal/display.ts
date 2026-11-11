export type PayPalDisplayMode = "mock" | "sandbox";

export function paypalModeLabel(mode: PayPalDisplayMode, credentialsConfigured: boolean): string {
  return mode === "sandbox" && credentialsConfigured ? "PayPal Sandbox" : "Simulated PayPal";
}

export function shortPayPalId(id: string): string {
  return id.length > 18 ? `${id.slice(0, 10)}…${id.slice(-6)}` : id;
}

export function installmentCheck(installments: { amountCents: number }[], originalCents: number) {
  const sumCents = installments.reduce((sum, item) => sum + item.amountCents, 0);
  return { sumCents, matchesOriginal: sumCents === originalCents };
}

export function paypalAuditLabel(action: string): string | undefined {
  if (action === "create_plan_invoices") return "PayPal API: create and send installment invoices";
  if (action === "cancel_original_invoice") return "PayPal API: cancel original invoice";
  if (action.startsWith("reconcile.invoice.")) return `PayPal API: read invoice · ${action.slice("reconcile.invoice.".length).toUpperCase()}`;
  return undefined;
}

export type PayPalSync = { at: string; source: "webhook" | "reconciler"; eventId?: string } | null;

export function lastPayPalSync(audit: { at: string; action: string }[], webhooks: { id: string; receivedAt: string; eventType: string; processedAt?: string | null }[]): PayPalSync {
  const candidates: NonNullable<PayPalSync>[] = [];
  for (const entry of audit) {
    if (entry.action.startsWith("reconcile.invoice.")) candidates.push({ at: entry.at, source: "reconciler" });
  }
  for (const event of webhooks) {
    if (event.processedAt) candidates.push({ at: event.processedAt, source: "webhook", eventId: event.id });
  }
  return candidates.sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0] ?? null;
}
