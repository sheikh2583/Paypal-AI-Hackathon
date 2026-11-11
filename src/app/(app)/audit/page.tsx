import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, Check, CircleX, ScrollText } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { db } from "@/lib/db/client";
import { getInvoice, listAudit } from "@/lib/db/queries";

export const metadata: Metadata = { title: "Audit log" };
export const dynamic = "force-dynamic";

function webhookContext(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return;
  const fields = input as Record<string, unknown>;
  const eventType = typeof fields.eventType === "string" ? fields.eventType : undefined;
  const paypalInvoiceId = typeof fields.paypalInvoiceId === "string" ? fields.paypalInvoiceId : undefined;
  const eventId = typeof fields.eventId === "string" ? fields.eventId : undefined;
  return [eventType, paypalInvoiceId ? `PayPal invoice ${paypalInvoiceId}` : undefined, eventId ? `event ${eventId}` : undefined]
    .filter(Boolean).join(" · ") || undefined;
}

function auditActionLabel(action: string): string {
  if (action === "webhook.invoice.unknown" || action === "webhook.invoice.unmatched") return "Unmatched PayPal event";
  if (action === "webhook.demo_reset.cancellation") return "PayPal invoice cancelled by demo reset";
  if (action === "webhook.processing.error") return "PayPal event needs reconciliation";
  return action.replaceAll("_", " ");
}

export default function AuditPage() {
  const entries = listAudit(undefined, db).slice(0, 100);
  return <div className="space-y-5">
    <PageHeader title="Audit log" description="A record of tool calls, policy decisions, simulated replies, and payments." />
    <section className="overflow-hidden rounded-2xl border bg-card shadow-sm"><div className="flex items-center justify-between border-b px-5 py-4"><div className="flex items-center gap-2"><ScrollText className="size-4 text-primary" /><h2 className="font-semibold">Recent activity</h2></div><span className="text-xs text-muted-foreground">Latest {entries.length}</span></div>
      {entries.length === 0 ? <p className="p-8 text-center text-sm text-muted-foreground">Actions will be recorded here as you run the demo.</p> : <ol className="divide-y">{entries.map((entry) => { const invoice = entry.invoiceId ? getInvoice(entry.invoiceId, db) : undefined; const unmatched = entry.action === "webhook.invoice.unknown" || entry.action === "webhook.invoice.unmatched"; const webhookDetails = entry.actor === "paypal" && entry.action.startsWith("webhook.") ? webhookContext(entry.input) : undefined; return <li key={entry.id} className="flex gap-3 px-5 py-4"><span className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg ${unmatched ? "bg-amber-50 text-amber-700" : entry.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>{unmatched ? <AlertTriangle className="size-4" /> : entry.ok ? <Check className="size-4" /> : <CircleX className="size-4" />}</span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-x-2 gap-y-1"><p className="font-medium">{auditActionLabel(entry.action)}</p><span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">{entry.actor}</span>{invoice ? <Link href={`/invoices/${invoice.id}`} className="text-xs text-primary hover:underline">{invoice.number}</Link> : null}</div>{webhookDetails ? <p className="mt-1 break-words text-xs text-muted-foreground">{webhookDetails}</p> : null}<p className="mt-1 break-words text-xs text-muted-foreground">{JSON.stringify(entry.result)}</p><time className="mt-1 block text-[11px] text-muted-foreground">{new Date(entry.at).toLocaleString()}</time></div></li>; })}</ol>}
    </section>
  </div>;
}
