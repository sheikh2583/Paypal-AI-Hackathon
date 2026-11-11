import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, Check, CircleX, Inbox, ScrollText, ShieldBan, Wallet } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { db } from "@/lib/db/client";
import { getInvoice, listAudit } from "@/lib/db/queries";
import { actorLabels, auditActionLabel, auditResultSummary } from "@/lib/labels";
import type { AuditEntry } from "@/lib/types";

export const metadata: Metadata = { title: "Audit log" };
export const dynamic = "force-dynamic";

function isDenial(entry: AuditEntry): boolean {
  return entry.actor === "agent" && !entry.ok && entry.action !== "agent_run";
}

function isDecisionRequest(entry: AuditEntry): boolean {
  const result = entry.result && typeof entry.result === "object" ? entry.result as Record<string, unknown> : {};
  return entry.action === "escalate_to_owner" || result.needsOwnerApproval === true || result.escalated === true;
}

export default function AuditPage() {
  const entries = listAudit(undefined, db).slice(0, 100);
  const agentActions = entries.filter((entry) => entry.actor === "agent" && entry.action !== "agent_run").length;
  const denials = entries.filter(isDenial).length;
  const decisions = entries.filter(isDecisionRequest).length;
  const paypal = entries.filter((entry) => entry.actor === "paypal" || entry.action === "create_plan_invoices" || entry.action === "cancel_original_invoice").length;

  return <div className="space-y-5">
    <PageHeader title="Audit log" description="Every action Chaser took, who triggered it, and what the policy decided. Expand any entry for the raw record." />
    <section aria-label="Audit summary" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Stat icon={ScrollText} label="Agent actions" value={agentActions} detail="tool calls Chaser made" />
      <Stat icon={ShieldBan} label="Blocked by policy" value={denials} detail="proposals the code refused" tone={denials ? "amber" : "default"} />
      <Stat icon={Inbox} label="Sent to you" value={decisions} detail="decisions that needed a human" />
      <Stat icon={Wallet} label="PayPal calls and events" value={paypal} detail="invoices issued, cancelled, or reported" />
    </section>
    <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      <div className="flex items-center justify-between border-b px-5 py-4"><div className="flex items-center gap-2"><ScrollText className="size-4 text-primary" /><h2 className="font-semibold">Recent activity</h2></div><span className="text-xs text-muted-foreground">Latest {entries.length}</span></div>
      {entries.length === 0 ? <p className="p-8 text-center text-sm text-muted-foreground">Actions will be recorded here as soon as Chaser does anything.</p> : <ol className="divide-y">{entries.map((entry) => {
        const invoice = entry.invoiceId ? getInvoice(entry.invoiceId, db) : undefined;
        const unmatched = entry.action === "webhook.invoice.unknown" || entry.action === "webhook.invoice.unmatched";
        const denied = isDenial(entry);
        const tone = unmatched || denied ? "bg-amber-50 text-amber-700" : entry.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700";
        return <li key={entry.id} className="flex gap-3 px-5 py-4">
          <span className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg ${tone}`}>{unmatched || denied ? <AlertTriangle className="size-4" /> : entry.ok ? <Check className="size-4" /> : <CircleX className="size-4" />}</span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <p className="font-medium">{auditActionLabel(entry.action)}</p>
              <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{actorLabels[entry.actor]}</span>
              {invoice ? <Link href={`/invoices/${invoice.id}`} className="text-xs text-primary hover:underline">{invoice.number}</Link> : null}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{auditResultSummary(entry.action, entry.result, entry.ok, entry.input)}</p>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 text-[11px] text-muted-foreground">
              <time>{new Date(entry.at).toLocaleString()}</time>
              <details className="min-w-0">
                <summary className="cursor-pointer hover:text-foreground">Raw record</summary>
                <pre className="mt-2 max-h-56 overflow-auto rounded-lg bg-secondary/60 p-3 text-[11px] leading-relaxed">{JSON.stringify({ action: entry.action, input: entry.input, result: entry.result }, null, 2)}</pre>
              </details>
            </div>
          </div>
        </li>;
      })}</ol>}
    </section>
  </div>;
}

function Stat({ icon: Icon, label, value, detail, tone = "default" }: { icon: typeof ScrollText; label: string; value: number; detail: string; tone?: "default" | "amber" }) {
  return <div className="rounded-2xl border bg-card p-4 shadow-sm">
    <div className="flex items-center justify-between"><span className="text-sm text-muted-foreground">{label}</span><span className={`grid size-9 place-items-center rounded-xl ${tone === "amber" ? "bg-amber-50 text-amber-700" : "bg-accent text-primary"}`}><Icon className="size-4" /></span></div>
    <p className="mt-3 text-3xl font-semibold tracking-tight tabular-nums">{value}</p>
    <p className="mt-1 text-sm text-muted-foreground">{detail}</p>
  </div>;
}
