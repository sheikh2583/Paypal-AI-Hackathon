import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink, FileText, MessageCircle, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { DemoControls } from "@/components/demo-controls";
import { getNow } from "@/lib/clock";
import { computeRisk } from "@/lib/risk";
import { riskFeaturesForInvoice } from "@/lib/risk/service";
import { db } from "@/lib/db/client";
import { getClient, getInvoice, getMessages, getPlan, listApprovals, listInvoicesByPlanId, listPlansByInvoiceId } from "@/lib/db/queries";

export const metadata: Metadata = { title: "Invoice" };
export const dynamic = "force-dynamic";
const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const invoice = getInvoice(id, db);
  if (!invoice) notFound();
  const client = getClient(invoice.clientId, db);
  if (!client) notFound();
  const messages = getMessages(id, db);
  const plan = invoice.planId ? getPlan(invoice.planId, db) : listPlansByInvoiceId(id, db)[0] ?? null;
  const approvals = listApprovals(undefined, db).filter((approval) => approval.invoiceId === id);
  const siblings = plan ? listInvoicesByPlanId(plan.id, db).filter((row) => row.parentInvoiceId === id).sort((a, b) => (a.installmentNo ?? 0) - (b.installmentNo ?? 0)) : [];
  const payment = siblings.find((row) => row.installmentNo === 1 && row.paypalInvoiceId && row.paidCents === 0 && row.status !== "CANCELLED");
  const overdueDays = Math.max(0, Math.floor((getNow().getTime() - Date.parse(invoice.dueAt)) / 86_400_000));
  const score = invoice.riskScore ?? computeRisk(riskFeaturesForInvoice(invoice, db, getNow())).score;

  return (
    <div className="space-y-6">
      <Link href="/" className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> All invoices</Link>
      <PageHeader title={invoice.number} description={`${client.name} · ${invoice.description}`} />

      <section className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-2xl border bg-card p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm text-muted-foreground">{invoice.status === "SUPERSEDED" ? "Original invoice amount" : "Balance due"}</p><p className="mt-1 text-3xl font-semibold tracking-tight">{money(Math.max(0, invoice.amountCents - invoice.paidCents))}</p><p className="mt-2 text-sm text-muted-foreground">{invoice.status === "SUPERSEDED" ? "Replaced by the installment invoices below." : `Original amount ${money(invoice.amountCents)} · ${overdueDays} days overdue`}</p></div><span className="rounded-full bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800">{invoice.status.replaceAll("_", " ")}</span></div>
          <div className="mt-5 grid grid-cols-2 gap-3 border-t pt-4 text-sm"><div><p className="text-xs text-muted-foreground">Chase state</p><p className="mt-1 font-medium">{invoice.chaseState.replaceAll("_", " ").toLowerCase()}</p></div><div><p className="text-xs text-muted-foreground">Risk score</p><p className="mt-1 font-medium">{score} / 100</p></div></div>
          {invoice.riskExplanation ? <div className="mt-4 flex gap-2 rounded-xl bg-secondary/70 p-3 text-sm"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" /><p>{invoice.riskExplanation}</p></div> : null}
        </div>
        <div className="rounded-2xl border bg-card p-5 shadow-sm"><div className="flex items-center gap-2"><FileText className="size-4 text-primary" /><h2 className="font-semibold">Client & invoice</h2></div><dl className="mt-4 grid grid-cols-[110px_1fr] gap-y-3 text-sm"><dt className="text-muted-foreground">Client</dt><dd className="font-medium">{client.name}</dd><dt className="text-muted-foreground">Business</dt><dd>{client.notes?.split(".")[0] ?? "Client"}</dd><dt className="text-muted-foreground">Invoice</dt><dd>{invoice.number}</dd><dt className="text-muted-foreground">Due date</dt><dd>{new Date(invoice.dueAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</dd><dt className="text-muted-foreground">Responsiveness</dt><dd className="capitalize">{client.responsiveness}</dd></dl></div>
      </section>

      {invoice.id === "invoice-dana-900" ? <DemoControls invoiceId={invoice.id} paymentId={payment?.paypalInvoiceId} stepComplete={plan?.status === "ACTIVE"} /> : null}

      {plan ? <section className="rounded-2xl border bg-card shadow-sm"><div className="flex items-center justify-between border-b px-5 py-4"><div><h2 className="font-semibold">Payment plan</h2><p className="mt-1 text-sm text-muted-foreground">{plan.status.replaceAll("_", " ")} · {plan.installments.length} installments · {plan.discountPercent}% discount</p></div><span className="rounded-full bg-accent px-3 py-1 text-xs font-semibold text-accent-foreground">{money(plan.totalCents)}</span></div><div className="divide-y">{plan.installments.map((installment) => { const row = siblings.find((sibling) => sibling.installmentNo === installment.no); return <div key={installment.no} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm"><div><p className="font-medium">{installment.no === 1 ? "Deposit" : `Installment ${installment.no}`}</p><p className="mt-0.5 text-xs text-muted-foreground">Due {new Date(installment.dueAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}{row ? ` · ${row.status.toLowerCase()}` : " · Awaiting approval"}</p></div><div className="flex items-center gap-3"><span className="font-semibold tabular-nums">{money(installment.amountCents)}</span>{row?.paypalInvoiceUrl ? <a href={row.paypalInvoiceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">PayPal view <ExternalLink className="size-3" /></a> : null}</div></div>; })}</div></section> : null}

      {approvals.length > 0 ? <section className="rounded-2xl border bg-card p-5 shadow-sm"><h2 className="font-semibold">Owner approvals</h2><div className="mt-3 space-y-3">{approvals.map((approval) => <div key={approval.id} className="rounded-xl bg-secondary/60 p-4"><div className="flex flex-wrap justify-between gap-2"><p className="text-sm font-semibold">{approval.kind.replaceAll("_", " ")}</p><span className="text-xs text-muted-foreground">{approval.status.toLowerCase()}</span></div><p className="mt-2 text-sm">{approval.reason}</p><p className="mt-2 text-sm text-muted-foreground">Recommendation: {approval.recommendation}</p></div>)}</div></section> : null}

      <section className="rounded-2xl border bg-card shadow-sm"><div className="border-b px-5 py-4"><div className="flex items-center gap-2"><MessageCircle className="size-4 text-primary" /><h2 className="font-semibold">Conversation & activity</h2></div><p className="mt-1 text-sm text-muted-foreground">Client replies are simulated for this demo; every agent action is audited.</p></div><ol className="space-y-3 p-5">{messages.map((message) => <li key={message.id} className={`max-w-2xl rounded-xl p-4 ${message.direction === "agent_to_client" ? "bg-primary text-primary-foreground" : message.direction === "client_to_agent" ? "ml-auto bg-accent text-accent-foreground" : "mx-auto bg-secondary text-muted-foreground"}`}><p className="mb-1 text-[11px] font-semibold uppercase tracking-wide opacity-75">{message.direction === "agent_to_client" ? "Chaser · simulated" : message.direction === "client_to_agent" ? client.name : "Activity"}</p><p className="whitespace-pre-wrap text-sm leading-relaxed">{message.body}</p></li>)}</ol></section>
    </div>
  );
}
