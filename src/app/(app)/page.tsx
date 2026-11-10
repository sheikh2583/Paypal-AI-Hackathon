import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CircleDollarSign, Clock3, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { DemoControls } from "@/components/demo-controls";
import { db } from "@/lib/db/client";
import { getMessages, listApprovals, listPlansByInvoiceId } from "@/lib/db/queries";
import { getNow } from "@/lib/clock";
import { getDemoSession } from "@/lib/auth";
import { demoEnabled } from "@/lib/demo";
import { getLlmEnv, getPayPalEnv } from "@/lib/env";
import { listInvoiceItems } from "@/lib/invoice-list";
import { reconcilePayPalOnRead } from "@/lib/paypal/poll";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(cents / 100);

export default async function DashboardPage() {
  if (await getDemoSession()) await reconcilePayPalOnRead();
  const now = getNow();
  const pending = listApprovals("PENDING", db);
  const allInvoices = listInvoiceItems(db, now, pending);
  const rows = allInvoices.filter(({ invoice }) => !invoice.parentInvoiceId && invoice.status !== "PAID");
  const openInvoices = allInvoices.filter(({ invoice }) => ["SENT", "OVERDUE", "PARTIALLY_PAID"].includes(invoice.status));
  const total = openInvoices.reduce((sum, { invoice }) => sum + Math.max(0, invoice.amountCents - invoice.paidCents), 0);
  const dana = rows.find(({ invoice }) => invoice.id === "invoice-dana-900");
  const danaPlan = dana ? listPlansByInvoiceId(dana.invoice.id, db)[0] : undefined;
  const danaMessages = dana ? getMessages(dana.invoice.id, db) : [];
  const planIssued = danaPlan?.status === "ACTIVE" || danaPlan?.status === "RESOLVED";
  const danaProgress: 0 | 1 | 2 | 3 = planIssued ? 3 : danaPlan ? 2 : danaMessages.some((message) => message.direction === "agent_to_client") ? 1 : 0;
  const paypalMode = getPayPalEnv().mode;

  return (
    <div className="space-y-7">
      <PageHeader title="Good morning, Maya" description="Your overdue invoices, ranked by collection risk. Chaser only acts within the policy you set." />

      <section aria-label="Portfolio summary" className="grid gap-3 sm:grid-cols-3">
        <SummaryCard icon={CircleDollarSign} label="Outstanding" value={money(total)} detail={`${openInvoices.length} open invoice records`} />
        <SummaryCard icon={Clock3} label="Waiting on you" value={String(pending.length)} detail="Pending owner approvals" />
        <SummaryCard icon={ShieldCheck} label="Policy guardrails" value="Active" detail="30% deposit · max 3 installments · 5% discount" />
      </section>

      {demoEnabled() ? <DemoControls invoiceId={dana?.invoice.id} progressStep={danaProgress} stepComplete={planIssued} paypalMode={paypalMode} llmMode={getLlmEnv().mode} showTimeControls /> : null}

      <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b px-5 py-4">
          <div><h2 className="font-semibold">Overdue invoices</h2><p className="mt-1 text-sm text-muted-foreground">Open an invoice to see the conversation and advance its scripted demo.</p></div>
          <span className="rounded-full bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground">{rows.length} invoices</span>
        </div>
        {rows.length === 0 ? <div className="p-8 text-center"><p className="font-medium">No demo invoices found</p><p className="mt-1 text-sm text-muted-foreground">Reset the demo to restore the seeded scenario.</p></div> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-secondary/60 text-xs uppercase tracking-wide text-muted-foreground"><tr><th className="px-5 py-3 font-medium">Client / invoice</th><th className="px-4 py-3 font-medium">Amount due</th><th className="px-4 py-3 font-medium">Risk</th><th className="px-4 py-3 font-medium">Chase state</th><th className="px-5 py-3 font-medium">Next action</th></tr></thead>
              <tbody className="divide-y">
                {rows.map(({ invoice, client, nextAction: action, riskLabel }) => {
                  return <tr key={invoice.id} className="transition hover:bg-secondary/30">
                    <td className="px-5 py-4"><Link href={`/invoices/${invoice.id}`} className="group flex items-center gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent text-sm font-semibold text-accent-foreground">{client.name.split(" ").map((part) => part[0]).slice(0, 2).join("")}</span><span><span className="block font-semibold group-hover:text-primary">{client.name}<ArrowRight className="ml-1 inline size-3 opacity-0 transition group-hover:opacity-100" /></span><span className="mt-0.5 block text-xs text-muted-foreground">{invoice.number} · {invoice.description}</span></span></Link></td>
                    <td className="px-4 py-4 font-semibold tabular-nums">{invoice.status === "SUPERSEDED" ? "In payment plan" : money(invoice.amountCents - invoice.paidCents)}<span className="mt-0.5 block text-xs font-normal text-muted-foreground">{invoice.status === "SUPERSEDED" ? "Replaced by installments" : `Due ${new Date(invoice.dueAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`}</span></td>
                    <td className="px-4 py-4"><span className={`inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-medium ${riskLabel === "High" ? "bg-red-50 text-red-700" : riskLabel === "Medium" ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-800"}`}><span className="size-1.5 rounded-full bg-current" />{riskLabel} · {invoice.riskScore}</span></td>
                    <td className="px-4 py-4"><span className="rounded-md bg-secondary px-2 py-1 text-xs">{invoice.chaseState.replaceAll("_", " ").toLowerCase()}</span></td>
                    <td className="px-5 py-4"><Link href={`/invoices/${invoice.id}`} className="text-sm font-medium text-primary hover:underline">{action}<ArrowRight className="ml-1 inline size-3.5" /></Link></td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="text-center text-xs text-muted-foreground">Demo workspace · fictional clients · PayPal {paypalMode} mode</p>
    </div>
  );
}

function SummaryCard({ icon: Icon, label, value, detail }: { icon: typeof CircleDollarSign; label: string; value: string; detail: string }) {
  return <div className="rounded-2xl border bg-card p-4 shadow-sm"><div className="flex items-center justify-between"><span className="text-sm text-muted-foreground">{label}</span><span className="grid size-9 place-items-center rounded-xl bg-accent text-primary"><Icon className="size-4" /></span></div><p className="mt-3 text-2xl font-semibold tracking-tight">{value}</p><p className="mt-1 text-xs text-muted-foreground">{detail}</p></div>;
}
